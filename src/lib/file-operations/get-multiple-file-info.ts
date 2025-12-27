import type {
  GetMultipleFileInfoResult,
  MultipleFileInfoResult,
} from '../../config/types.js';
import { PARALLEL_CONCURRENCY } from '../constants.js';
import { processInParallel } from '../fs-helpers.js';
import { applyParallelResults, createOutputSkeleton } from './batch-results.js';
import { getFileInfo } from './file-info.js';

interface GetMultipleFileInfoOptions {
  includeMimeType?: boolean;
}

async function processFileInfo(
  filePath: string,
  options: GetMultipleFileInfoOptions
): Promise<MultipleFileInfoResult> {
  const info = await getFileInfo(filePath, {
    includeMimeType: options.includeMimeType,
  });

  return {
    path: filePath,
    info,
  };
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
  options: GetMultipleFileInfoOptions = {}
): Promise<GetMultipleFileInfoResult> {
  if (paths.length === 0) {
    return {
      results: [],
      summary: { total: 0, succeeded: 0, failed: 0, totalSize: 0 },
    };
  }

  const output = createOutputSkeleton(paths, (filePath) => ({
    path: filePath,
  }));

  const { results, errors } = await processInParallel(
    paths.map((filePath, index) => ({ filePath, index })),
    async ({ filePath, index }) => ({
      index,
      value: await processFileInfo(filePath, options),
    }),
    PARALLEL_CONCURRENCY
  );

  applyParallelResults(output, results, errors, paths, (filePath, error) => ({
    path: filePath,
    error: error.message,
  }));

  return {
    results: output,
    summary: calculateSummary(output),
  };
}
