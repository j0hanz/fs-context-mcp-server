import { MAX_TEXT_FILE_SIZE } from '../constants.js';
import { assertLineRangeOptions, buildLineRange } from '../line-range.js';
import {
  applyParallelResults,
  applySkippedBudgetErrors,
  buildProcessTargets,
  collectFileBudget,
  createOutputSkeleton,
  isPartialRead,
  mapParallelErrors,
  type NormalizedReadMultipleOptions,
  readFilesInParallel,
  type ReadMultipleResult,
} from './read-multiple-utils.js';

interface ReadMultipleOptions {
  encoding?: BufferEncoding;
  maxSize?: number;
  maxTotalSize?: number;
  head?: number;
  tail?: number;
  lineStart?: number;
  lineEnd?: number;
  signal?: AbortSignal;
}

function normalizeReadMultipleOptions(
  options: ReadMultipleOptions,
  pathLabel: string
): NormalizedReadMultipleOptions {
  assertLineRangeOptions(
    {
      lineStart: options.lineStart,
      lineEnd: options.lineEnd,
      head: options.head,
      tail: options.tail,
    },
    pathLabel
  );
  const lineRange = buildLineRange(options.lineStart, options.lineEnd);
  return {
    encoding: options.encoding ?? 'utf-8',
    maxSize: Math.min(
      options.maxSize ?? MAX_TEXT_FILE_SIZE,
      MAX_TEXT_FILE_SIZE
    ),
    maxTotalSize: options.maxTotalSize ?? 100 * 1024 * 1024,
    lineRange,
    head: options.head,
    tail: options.tail,
  };
}

export async function readMultipleFiles(
  filePaths: string[],
  options: ReadMultipleOptions = {}
): Promise<ReadMultipleResult[]> {
  if (filePaths.length === 0) return [];

  const pathLabel = filePaths[0] ?? '<paths>';
  const { signal, ...rest } = options;
  const normalized = normalizeReadMultipleOptions(rest, pathLabel);

  const output = createOutputSkeleton(filePaths);
  const partialRead = isPartialRead(normalized);
  const { skippedBudget, validated } = await collectFileBudget(
    filePaths,
    partialRead,
    normalized.maxTotalSize,
    normalized.maxSize,
    signal
  );

  const filesToProcess = buildProcessTargets(
    filePaths,
    skippedBudget,
    validated
  );

  const { results, errors } = await readFilesInParallel(
    filesToProcess,
    normalized,
    signal
  );
  const mappedErrors = mapParallelErrors(errors, filesToProcess);

  applyParallelResults(output, results, mappedErrors, filePaths);
  applySkippedBudgetErrors(
    output,
    skippedBudget,
    filePaths,
    normalized.maxTotalSize
  );

  return output;
}
