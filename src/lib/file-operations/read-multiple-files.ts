import * as fs from 'node:fs/promises';
import type { Stats } from 'node:fs';

import { MAX_TEXT_FILE_SIZE, PARALLEL_CONCURRENCY } from '../constants.js';
import {
  processInParallel,
  readFile,
  readFileWithStats,
} from '../fs-helpers.js';
import { withAbort } from '../fs-helpers/abort.js';
import { assertLineRangeOptions, buildLineRange } from '../line-range.js';
import { validateExistingPath } from '../path-validation.js';

interface ReadMultipleResult {
  path: string;
  content?: string;
  truncated?: boolean;
  totalLines?: number;
  readMode?: 'full' | 'head' | 'tail' | 'lineRange';
  lineStart?: number;
  lineEnd?: number;
  head?: number;
  tail?: number;
  linesRead?: number;
  hasMoreLines?: boolean;
  error?: string;
}

interface ValidatedFileInfo {
  index: number;
  filePath: string;
  validPath: string;
  stats: Stats;
}

interface NormalizedReadMultipleOptions {
  encoding: BufferEncoding;
  maxSize: number;
  maxTotalSize: number;
  lineRange?: { start: number; end: number };
  head?: number;
  tail?: number;
}

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

function isPartialRead(options: NormalizedReadMultipleOptions): boolean {
  return (
    options.lineRange !== undefined ||
    options.head !== undefined ||
    options.tail !== undefined
  );
}

async function collectFileBudget(
  filePaths: string[],
  partialRead: boolean,
  maxTotalSize: number,
  maxSize: number,
  signal?: AbortSignal
): Promise<{
  skippedBudget: Set<number>;
  validated: Map<number, ValidatedFileInfo>;
}> {
  const skippedBudget = new Set<number>();
  const validated = new Map<number, ValidatedFileInfo>();

  const { results } = await processInParallel(
    filePaths.map((filePath, index) => ({ filePath, index })),
    async ({ filePath, index }) => {
      const validPath = await validateExistingPath(filePath, signal);
      const stats = await withAbort(fs.stat(validPath), signal);
      return { filePath, index, validPath, stats };
    },
    PARALLEL_CONCURRENCY,
    signal
  );

  let totalSize = 0;
  const orderedResults = [...results].sort((a, b) => a.index - b.index);

  for (const result of orderedResults) {
    validated.set(result.index, {
      index: result.index,
      filePath: result.filePath,
      validPath: result.validPath,
      stats: result.stats,
    });
    const estimatedSize = partialRead
      ? Math.min(result.stats.size, maxSize)
      : result.stats.size;
    if (totalSize + estimatedSize > maxTotalSize) {
      skippedBudget.add(result.index);
      continue;
    }
    totalSize += estimatedSize;
  }

  return { skippedBudget, validated };
}

async function readFilesInParallel(
  filesToProcess: {
    filePath: string;
    index: number;
    validPath?: string;
    stats?: Stats;
  }[],
  options: NormalizedReadMultipleOptions,
  signal?: AbortSignal
): Promise<{
  results: { index: number; value: ReadMultipleResult }[];
  errors: { index: number; error: Error }[];
}> {
  return await processInParallel(
    filesToProcess,
    async ({ filePath, index, validPath, stats }) => {
      const readOptions = {
        encoding: options.encoding,
        maxSize: options.maxSize,
        head: options.head,
        tail: options.tail,
        lineRange: options.lineRange,
        signal,
      };
      const result =
        validPath && stats
          ? await readFileWithStats(filePath, validPath, stats, readOptions)
          : await readFile(filePath, readOptions);

      return {
        index,
        value: {
          path: filePath,
          content: result.content,
          truncated: result.truncated,
          totalLines: result.totalLines,
          readMode: result.readMode,
          lineStart: result.lineStart,
          lineEnd: result.lineEnd,
          head: result.head,
          tail: result.tail,
          linesRead: result.linesRead,
          hasMoreLines: result.hasMoreLines,
        },
      };
    },
    PARALLEL_CONCURRENCY,
    signal
  );
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

  const output: ReadMultipleResult[] = filePaths.map((filePath) => ({
    path: filePath,
  }));
  const partialRead = isPartialRead(normalized);
  const { skippedBudget, validated } = await collectFileBudget(
    filePaths,
    partialRead,
    normalized.maxTotalSize,
    normalized.maxSize,
    signal
  );

  const filesToProcess = filePaths
    .map((filePath, index) => {
      const cached = validated.get(index);
      return cached
        ? {
            filePath,
            index,
            validPath: cached.validPath,
            stats: cached.stats,
          }
        : { filePath, index };
    })
    .filter(({ index }) => !skippedBudget.has(index));

  const { results, errors } = await readFilesInParallel(
    filesToProcess,
    normalized,
    signal
  );

  for (const result of results) {
    output[result.index] = result.value;
  }

  for (const failure of errors) {
    const target = filesToProcess[failure.index];
    const originalIndex = target?.index ?? -1;
    if (originalIndex < 0) continue;
    const filePath = filePaths[originalIndex] ?? '(unknown)';
    output[originalIndex] = {
      path: filePath,
      error: failure.error.message,
    };
  }

  for (const index of skippedBudget) {
    const filePath = filePaths[index];
    if (!filePath) continue;
    output[index] = {
      path: filePath,
      error: `Skipped: combined estimated read would exceed maxTotalSize (${normalized.maxTotalSize} bytes)`,
    };
  }

  return output;
}
