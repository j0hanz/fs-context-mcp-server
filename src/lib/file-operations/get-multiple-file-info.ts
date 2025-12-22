import type { FileInfo } from '../../config/types.js';
import { PARALLEL_CONCURRENCY } from '../constants.js';
import { processInParallel } from '../fs-helpers.js';
import { validateExistingPath } from '../path-validation.js';
import { getFileInfo } from './file-info.js';

interface GetMultipleFileInfoOptions {
  includeMimeType?: boolean;
}

interface MultipleFileInfoResult {
  path: string;
  info?: FileInfo;
  error?: string;
}

interface GetMultipleFileInfoResult {
  results: MultipleFileInfoResult[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    totalSize: number;
  };
}

function createOutputSkeleton(paths: string[]): MultipleFileInfoResult[] {
  return paths.map((filePath) => ({ path: filePath }));
}

async function processFileInfo(
  filePath: string
): Promise<MultipleFileInfoResult> {
  const validPath = await validateExistingPath(filePath);
  const info = await getFileInfo(validPath);

  return {
    path: filePath,
    info,
  };
}

function applyResults(
  output: MultipleFileInfoResult[],
  results: MultipleFileInfoResult[],
  errors: { index: number; error: Error }[],
  paths: string[]
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
        error: failure.error.message,
      };
    }
  }
}

function calculateSummary(results: MultipleFileInfoResult[]): {
  total: number;
  succeeded: number;
  failed: number;
  totalSize: number;
} {
  let succeeded = 0;
  let failed = 0;
  let totalSize = 0;

  for (const result of results) {
    if (result.info !== undefined) {
      succeeded++;
      totalSize += result.info.size;
    } else {
      failed++;
    }
  }

  return {
    total: results.length,
    succeeded,
    failed,
    totalSize,
  };
}

export async function getMultipleFileInfo(
  paths: string[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options: GetMultipleFileInfoOptions = {}
): Promise<GetMultipleFileInfoResult> {
  if (paths.length === 0) {
    return {
      results: [],
      summary: { total: 0, succeeded: 0, failed: 0, totalSize: 0 },
    };
  }

  const output = createOutputSkeleton(paths);

  const { results, errors } = await processInParallel(
    paths.map((filePath, index) => ({ filePath, index })),
    async ({ filePath }) => processFileInfo(filePath),
    PARALLEL_CONCURRENCY
  );

  applyResults(output, results, errors, paths);

  return {
    results: output,
    summary: calculateSummary(output),
  };
}
