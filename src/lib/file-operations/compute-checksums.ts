import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';

import { PARALLEL_CONCURRENCY } from '../constants.js';
import { ErrorCode, McpError } from '../errors.js';
import { processInParallel } from '../fs-helpers.js';
import { validateExistingPath } from '../path-validation.js';

type ChecksumAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha512';
type ChecksumEncoding = 'hex' | 'base64';

interface ComputeChecksumsOptions {
  algorithm?: ChecksumAlgorithm;
  encoding?: ChecksumEncoding;
  maxFileSize?: number;
}

interface ChecksumResult {
  path: string;
  checksum?: string;
  algorithm: ChecksumAlgorithm;
  size?: number;
  error?: string;
}

interface ComputeChecksumsResult {
  results: ChecksumResult[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
}

const DEFAULT_MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

async function computeSingleChecksum(
  filePath: string,
  algorithm: ChecksumAlgorithm,
  encoding: ChecksumEncoding,
  maxFileSize: number
): Promise<ChecksumResult> {
  const validPath = await validateExistingPath(filePath);

  // Check file stats
  const stats = await fsPromises.stat(validPath);

  if (stats.isDirectory()) {
    throw new McpError(
      ErrorCode.E_NOT_FILE,
      `Cannot compute checksum for directory: ${filePath}`,
      filePath
    );
  }

  if (stats.size > maxFileSize) {
    throw new McpError(
      ErrorCode.E_TOO_LARGE,
      `File exceeds maximum size (${stats.size} > ${maxFileSize}): ${filePath}`,
      filePath
    );
  }

  // Compute hash using streaming for memory efficiency
  const hash = await computeHashStream(validPath, algorithm);
  const checksum = hash.digest(encoding as crypto.BinaryToTextEncoding);

  return {
    path: filePath,
    checksum,
    algorithm,
    size: stats.size,
  };
}

function computeHashStream(
  filePath: string,
  algorithm: ChecksumAlgorithm
): Promise<crypto.Hash> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk: Buffer | string) => {
      hash.update(chunk);
    });

    stream.on('end', () => {
      resolve(hash);
    });

    stream.on('error', (error) => {
      reject(error);
    });
  });
}

function createOutputSkeleton(
  paths: string[],
  algorithm: ChecksumAlgorithm
): ChecksumResult[] {
  return paths.map((filePath) => ({
    path: filePath,
    algorithm,
  }));
}

function applyResults(
  output: ChecksumResult[],
  results: ChecksumResult[],
  errors: { index: number; error: Error }[],
  paths: string[],
  algorithm: ChecksumAlgorithm
): void {
  // Apply successful results
  for (const result of results) {
    const index = paths.indexOf(result.path);
    if (index !== -1 && output[index] !== undefined) {
      output[index] = result;
    }
  }

  // Apply errors
  for (const failure of errors) {
    const filePath = paths[failure.index] ?? '(unknown)';
    if (output[failure.index] !== undefined) {
      output[failure.index] = {
        path: filePath,
        algorithm,
        error: failure.error.message,
      };
    }
  }
}

function calculateSummary(results: ChecksumResult[]): {
  total: number;
  succeeded: number;
  failed: number;
} {
  let succeeded = 0;
  let failed = 0;

  for (const result of results) {
    if (result.checksum !== undefined) {
      succeeded++;
    } else {
      failed++;
    }
  }

  return {
    total: results.length,
    succeeded,
    failed,
  };
}

export async function computeChecksums(
  paths: string[],
  options: ComputeChecksumsOptions = {}
): Promise<ComputeChecksumsResult> {
  if (paths.length === 0) {
    return {
      results: [],
      summary: { total: 0, succeeded: 0, failed: 0 },
    };
  }

  const algorithm: ChecksumAlgorithm = options.algorithm ?? 'sha256';
  const encoding: ChecksumEncoding = options.encoding ?? 'hex';
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;

  const output = createOutputSkeleton(paths, algorithm);

  const { results, errors } = await processInParallel(
    paths.map((filePath, index) => ({ filePath, index })),
    async ({ filePath }) =>
      computeSingleChecksum(filePath, algorithm, encoding, maxFileSize),
    PARALLEL_CONCURRENCY
  );

  applyResults(output, results, errors, paths, algorithm);

  return {
    results: output,
    summary: calculateSummary(output),
  };
}
