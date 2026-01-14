import * as fsp from 'node:fs/promises';
import type { Stats } from 'node:fs';

import {
  DEFAULT_READ_MANY_MAX_TOTAL_SIZE,
  MAX_TEXT_FILE_SIZE,
  PARALLEL_CONCURRENCY,
} from '../constants.js';
import {
  processInParallel,
  readFile,
  readFileWithStats,
  withAbort,
} from '../fs-helpers.js';
import { validateExistingPath } from '../path-validation.js';

export interface ReadMultipleResult {
  path: string;
  content?: string;
  truncated?: boolean;
  totalLines?: number;
  readMode?: 'full' | 'head' | 'range';
  head?: number;
  startLine?: number;
  endLine?: number;
  linesRead?: number;
  hasMoreLines?: boolean;
  error?: string;
}

interface NormalizedReadMultipleOptions {
  encoding: BufferEncoding;
  maxSize: number;
  maxTotalSize: number;
  head?: number;
  startLine?: number;
  endLine?: number;
}

export interface ReadMultipleOptions {
  encoding?: BufferEncoding;
  maxSize?: number;
  maxTotalSize?: number;
  head?: number;
  startLine?: number;
  endLine?: number;
  signal?: AbortSignal;
}

interface FileReadTask {
  filePath: string;
  index: number;
  validPath?: string;
  stats?: Stats;
}

function buildReadOptions(options: NormalizedReadMultipleOptions): {
  encoding: BufferEncoding;
  maxSize: number;
  head?: number;
  startLine?: number;
  endLine?: number;
} {
  const readOptions: {
    encoding: BufferEncoding;
    maxSize: number;
    head?: number;
    startLine?: number;
    endLine?: number;
  } = {
    encoding: options.encoding,
    maxSize: options.maxSize,
  };
  if (options.head !== undefined) {
    readOptions.head = options.head;
  }
  if (options.startLine !== undefined) {
    readOptions.startLine = options.startLine;
  }
  if (options.endLine !== undefined) {
    readOptions.endLine = options.endLine;
  }
  return readOptions;
}

function buildReadMultipleResult(
  filePath: string,
  result: Awaited<ReturnType<typeof readFile>>
): ReadMultipleResult {
  const value: ReadMultipleResult = {
    path: filePath,
    content: result.content,
    truncated: result.truncated,
    readMode: result.readMode,
  };
  if (result.totalLines !== undefined) value.totalLines = result.totalLines;
  if (result.head !== undefined) value.head = result.head;
  if (result.startLine !== undefined) value.startLine = result.startLine;
  if (result.endLine !== undefined) value.endLine = result.endLine;
  if (result.linesRead !== undefined) value.linesRead = result.linesRead;
  if (result.hasMoreLines !== undefined) {
    value.hasMoreLines = result.hasMoreLines;
  }
  return value;
}

async function readSingleFile(
  task: FileReadTask,
  options: NormalizedReadMultipleOptions,
  signal?: AbortSignal
): Promise<{ index: number; value: ReadMultipleResult }> {
  const { filePath, index, validPath, stats } = task;
  const readOptions: Parameters<typeof readFile>[1] = {
    ...buildReadOptions(options),
  };
  if (signal) {
    readOptions.signal = signal;
  }
  const result =
    validPath && stats
      ? await readFileWithStats(filePath, validPath, stats, readOptions)
      : await readFile(filePath, readOptions);

  return {
    index,
    value: buildReadMultipleResult(filePath, result),
  };
}

function isPartialRead(options: NormalizedReadMultipleOptions): boolean {
  return options.head !== undefined || options.startLine !== undefined;
}

async function readFilesInParallel(
  filesToProcess: FileReadTask[],
  options: NormalizedReadMultipleOptions,
  signal?: AbortSignal
): Promise<{
  results: { index: number; value: ReadMultipleResult }[];
  errors: { index: number; error: Error }[];
}> {
  return await processInParallel(
    filesToProcess,
    async (task) => readSingleFile(task, options, signal),
    PARALLEL_CONCURRENCY,
    signal
  );
}

function normalizeReadMultipleOptions(
  options: ReadMultipleOptions
): NormalizedReadMultipleOptions {
  const normalized: NormalizedReadMultipleOptions = {
    encoding: options.encoding ?? 'utf-8',
    maxSize: Math.min(
      options.maxSize ?? MAX_TEXT_FILE_SIZE,
      MAX_TEXT_FILE_SIZE
    ),
    maxTotalSize: options.maxTotalSize ?? DEFAULT_READ_MANY_MAX_TOTAL_SIZE,
  };
  if (options.head !== undefined) {
    normalized.head = options.head;
  }
  if (options.startLine !== undefined) {
    normalized.startLine = options.startLine;
  }
  if (options.endLine !== undefined) {
    normalized.endLine = options.endLine;
  }
  return normalized;
}

function resolveNormalizedOptions(
  _filePaths: readonly string[],
  options: ReadMultipleOptions
): { normalized: NormalizedReadMultipleOptions; signal?: AbortSignal } {
  const { signal, ...rest } = options;
  const resolved: {
    normalized: NormalizedReadMultipleOptions;
    signal?: AbortSignal;
  } = { normalized: normalizeReadMultipleOptions(rest) };
  if (signal) {
    resolved.signal = signal;
  }
  return resolved;
}

interface ValidatedFileInfo {
  index: number;
  filePath: string;
  validPath: string;
  stats: Stats;
}

async function validateFile(
  filePath: string,
  index: number,
  signal?: AbortSignal
): Promise<ValidatedFileInfo> {
  const validPath = await validateExistingPath(filePath, signal);
  const stats = await withAbort(fsp.stat(validPath), signal);
  return { filePath, index, validPath, stats };
}

type SizeEstimator = (stats: Stats) => number;

function estimatePartialSize(stats: Stats, maxSize: number): number {
  return Math.min(stats.size, maxSize);
}

function estimateFullSize(stats: Stats): number {
  return stats.size;
}

function applyBudget(
  orderedResults: ValidatedFileInfo[],
  estimateSize: SizeEstimator,
  maxTotalSize: number
): { skippedBudget: Set<number>; validated: Map<number, ValidatedFileInfo> } {
  const skippedBudget = new Set<number>();
  const validated = new Map<number, ValidatedFileInfo>();
  let totalSize = 0;

  for (const result of orderedResults) {
    validated.set(result.index, result);
    const estimatedSize = estimateSize(result.stats);
    if (totalSize + estimatedSize > maxTotalSize) {
      skippedBudget.add(result.index);
      continue;
    }
    totalSize += estimatedSize;
  }

  return { skippedBudget, validated };
}

async function collectFileBudget(
  filePaths: readonly string[],
  partialRead: boolean,
  maxTotalSize: number,
  maxSize: number,
  signal?: AbortSignal
): Promise<{
  skippedBudget: Set<number>;
  validated: Map<number, ValidatedFileInfo>;
}> {
  const { results } = await processInParallel(
    filePaths.map((filePath, index) => ({ filePath, index })),
    async ({ filePath, index }) => validateFile(filePath, index, signal),
    PARALLEL_CONCURRENCY,
    signal
  );

  const orderedResults = [...results].sort((a, b) => a.index - b.index);
  const estimateSize = partialRead
    ? (stats: Stats) => estimatePartialSize(stats, maxSize)
    : estimateFullSize;
  return applyBudget(orderedResults, estimateSize, maxTotalSize);
}

function buildOutput(filePaths: readonly string[]): ReadMultipleResult[] {
  return filePaths.map((filePath) => ({ path: filePath }));
}

function applyResults(
  output: ReadMultipleResult[],
  results: { index: number; value: ReadMultipleResult }[]
): void {
  for (const result of results) {
    output[result.index] = result.value;
  }
}

function applyErrors(
  output: ReadMultipleResult[],
  errors: { index: number; error: Error }[],
  filesToProcess: { index: number }[],
  filePaths: readonly string[]
): void {
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
}

function buildFilesToProcess(
  filePaths: readonly string[],
  validated: Map<
    number,
    {
      validPath: string;
      stats: Stats;
    }
  >,
  skippedBudget: Set<number>
): FileReadTask[] {
  return filePaths
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
}

function applySkippedBudget(
  output: ReadMultipleResult[],
  skippedBudget: Set<number>,
  filePaths: readonly string[],
  maxTotalSize: number
): void {
  for (const index of skippedBudget) {
    const filePath = filePaths[index];
    if (!filePath) continue;
    output[index] = {
      path: filePath,
      error: `Skipped: combined estimated read would exceed maxTotalSize (${maxTotalSize} bytes)`,
    };
  }
}

export async function readMultipleFiles(
  filePaths: readonly string[],
  options: ReadMultipleOptions = {}
): Promise<ReadMultipleResult[]> {
  if (filePaths.length === 0) return [];

  const { normalized, signal } = resolveNormalizedOptions(filePaths, options);

  const output = buildOutput(filePaths);
  const partialRead = isPartialRead(normalized);
  const { skippedBudget, validated } = await collectFileBudget(
    filePaths,
    partialRead,
    normalized.maxTotalSize,
    normalized.maxSize,
    signal
  );

  const filesToProcess = buildFilesToProcess(
    filePaths,
    validated,
    skippedBudget
  );

  const { results, errors } = await readFilesInParallel(
    filesToProcess,
    normalized,
    signal
  );

  applyResults(output, results);
  applyErrors(output, errors, filesToProcess, filePaths);
  applySkippedBudget(output, skippedBudget, filePaths, normalized.maxTotalSize);

  return output;
}
