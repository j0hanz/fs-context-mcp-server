import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import type { Stats } from 'node:fs';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type {
  ChecksumAlgorithm,
  ChecksumEncoding,
  ChecksumResult,
  ComputeChecksumsResult,
} from '../../config/types.js';
import { PARALLEL_CONCURRENCY } from '../constants.js';
import { ErrorCode, McpError } from '../errors.js';
import { processInParallel } from '../fs-helpers.js';
import { validateExistingPath } from '../path-validation.js';
import { applyParallelResults, createOutputSkeleton } from './batch-results.js';

interface ComputeChecksumsOptions {
  algorithm?: ChecksumAlgorithm;
  encoding?: ChecksumEncoding;
  maxFileSize?: number;
  signal?: AbortSignal;
}

const DEFAULT_MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const DEFAULT_ALGORITHM: ChecksumAlgorithm = 'sha256';
const DEFAULT_ENCODING: ChecksumEncoding = 'hex';

function normalizeComputeOptions(options: ComputeChecksumsOptions): {
  algorithm: ChecksumAlgorithm;
  encoding: ChecksumEncoding;
  maxFileSize: number;
} {
  return {
    algorithm: options.algorithm ?? DEFAULT_ALGORITHM,
    encoding: options.encoding ?? DEFAULT_ENCODING,
    maxFileSize: options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
  };
}

function buildEmptyResult(): ComputeChecksumsResult {
  return {
    results: [],
    summary: { total: 0, succeeded: 0, failed: 0 },
  };
}

function ensureFileIsRegular(stats: Stats, filePath: string): void {
  if (stats.isDirectory()) {
    throw new McpError(
      ErrorCode.E_NOT_FILE,
      `Cannot compute checksum for directory: ${filePath}`,
      filePath
    );
  }

  if (!stats.isFile()) {
    throw new McpError(
      ErrorCode.E_NOT_FILE,
      `Cannot compute checksum for non-file path: ${filePath}`,
      filePath
    );
  }
}

function ensureMaxFileSize(
  size: number,
  maxFileSize: number,
  filePath: string
): void {
  if (size <= maxFileSize) return;
  throw new McpError(
    ErrorCode.E_TOO_LARGE,
    `File exceeds maximum size (${size} > ${maxFileSize}): ${filePath}`,
    filePath
  );
}

function buildChecksumResult(
  filePath: string,
  checksum: string,
  algorithm: ChecksumAlgorithm,
  size: number
): ChecksumResult {
  return {
    path: filePath,
    checksum,
    algorithm,
    size,
  };
}

async function computeSingleChecksum(
  filePath: string,
  algorithm: ChecksumAlgorithm,
  encoding: ChecksumEncoding,
  maxFileSize: number
): Promise<ChecksumResult> {
  const validPath = await validateExistingPath(filePath);

  const stats = await fs.stat(validPath);
  ensureFileIsRegular(stats, filePath);
  ensureMaxFileSize(stats.size, maxFileSize, filePath);

  const hash = await computeHashStream(
    validPath,
    algorithm,
    maxFileSize,
    filePath
  );
  const checksum = hash.digest(encoding as crypto.BinaryToTextEncoding);

  return buildChecksumResult(filePath, checksum, algorithm, stats.size);
}

function createTooLargeError(
  bytesRead: number,
  maxFileSize: number,
  requestedPath: string
): McpError {
  return new McpError(
    ErrorCode.E_TOO_LARGE,
    `File exceeds maximum size (${bytesRead} > ${maxFileSize}): ${requestedPath}`,
    requestedPath
  );
}

class HashSink extends Writable {
  private bytesRead = 0;

  constructor(
    private readonly hash: crypto.Hash,
    private readonly maxFileSize: number,
    private readonly requestedPath: string
  ) {
    super();
  }

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    const size =
      typeof chunk === 'string'
        ? Buffer.byteLength(chunk, encoding)
        : chunk.length;
    this.bytesRead += size;

    if (this.bytesRead > this.maxFileSize) {
      callback(
        createTooLargeError(
          this.bytesRead,
          this.maxFileSize,
          this.requestedPath
        )
      );
      return;
    }

    if (typeof chunk === 'string') {
      this.hash.update(chunk, encoding);
    } else {
      this.hash.update(chunk);
    }

    callback();
  }
}

function computeHashStream(
  filePath: string,
  algorithm: ChecksumAlgorithm,
  maxFileSize: number,
  requestedPath: string
): Promise<crypto.Hash> {
  const hash = crypto.createHash(algorithm);
  const sink = new HashSink(hash, maxFileSize, requestedPath);
  return pipeline(createReadStream(filePath), sink).then(() => hash);
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
  if (paths.length === 0) return buildEmptyResult();

  const { signal, ...rest } = options;
  const { algorithm, encoding, maxFileSize } = normalizeComputeOptions(rest);

  const output = createOutputSkeleton(paths, (filePath) => ({
    path: filePath,
    algorithm,
  }));

  const { results, errors } = await processInParallel(
    paths.map((filePath, index) => ({ filePath, index })),
    async ({ filePath, index }) => ({
      index,
      value: await computeSingleChecksum(
        filePath,
        algorithm,
        encoding,
        maxFileSize
      ),
    }),
    PARALLEL_CONCURRENCY,
    signal
  );

  applyParallelResults(output, results, errors, paths, (filePath, error) => ({
    path: filePath,
    algorithm,
    error: error.message,
  }));

  return {
    results: output,
    summary: calculateSummary(output),
  };
}
