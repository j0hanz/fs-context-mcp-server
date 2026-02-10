import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { Stats } from 'node:fs';

import type {
  FileInfo,
  GetMultipleFileInfoResult,
  MultipleFileInfoResult,
} from '../../config.js';
import { getMimeType, PARALLEL_CONCURRENCY } from '../constants.js';
import { isAbortError } from '../errors.js';
import {
  assertNotAborted,
  getFileType,
  isHidden,
  processInParallel,
  withAbort,
} from '../fs-helpers.js';
import { assertAllowedFileAccess } from '../path-policy.js';
import { validateExistingPathDetailed } from '../path-validation.js';

const PERM_STRINGS = [
  '---',
  '--x',
  '-w-',
  '-wx',
  'r--',
  'r-x',
  'rw-',
  'rwx',
] as const satisfies readonly string[];

interface FileInfoOptions {
  includeMimeType?: boolean | undefined;
  signal?: AbortSignal | undefined;
}

function getPermissions(mode: number): string {
  const ownerIndex = (mode >> 6) & 0b111;
  const groupIndex = (mode >> 3) & 0b111;
  const otherIndex = mode & 0b111;

  const owner = PERM_STRINGS[ownerIndex] ?? '---';
  const group = PERM_STRINGS[groupIndex] ?? '---';
  const other = PERM_STRINGS[otherIndex] ?? '---';

  return `${owner}${group}${other}`;
}

function buildFileInfoResult(
  name: string,
  requestedPath: string,
  isSymlink: boolean,
  stats: Stats,
  mimeType: string | undefined,
  symlinkTarget: string | undefined
): FileInfo {
  const tokenEstimate = stats.isFile() ? Math.ceil(stats.size / 4) : undefined;
  return {
    name,
    path: requestedPath,
    type: isSymlink ? 'symlink' : getFileType(stats),
    size: stats.size,
    ...(tokenEstimate !== undefined ? { tokenEstimate } : {}),
    created: stats.birthtime,
    modified: stats.mtime,
    accessed: stats.atime,
    permissions: getPermissions(stats.mode),
    isHidden: isHidden(name),
    ...(mimeType !== undefined ? { mimeType } : {}),
    ...(symlinkTarget !== undefined ? { symlinkTarget } : {}),
  };
}

async function getSymlinkTarget(
  pathToRead: string,
  signal?: AbortSignal
): Promise<string | undefined> {
  assertNotAborted(signal);
  try {
    return await withAbort(fsp.readlink(pathToRead), signal);
  } catch (error) {
    if (isAbortError(error)) throw error;
    return undefined;
  }
}

export async function getFileInfo(
  filePath: string,
  options: FileInfoOptions = {}
): Promise<FileInfo> {
  const { signal } = options;
  assertNotAborted(signal);

  const { requestedPath, resolvedPath, isSymlink } =
    await validateExistingPathDetailed(filePath, signal);

  assertAllowedFileAccess(requestedPath, resolvedPath);

  const name = path.basename(requestedPath);
  const ext = path.extname(name).toLowerCase();
  const includeMimeType = options.includeMimeType !== false;
  const mimeType =
    includeMimeType && ext.length > 0 ? getMimeType(ext) : undefined;

  const symlinkTarget = isSymlink
    ? await getSymlinkTarget(requestedPath, signal)
    : undefined;

  const stats = await withAbort(fsp.stat(resolvedPath), signal);

  return buildFileInfoResult(
    name,
    requestedPath,
    isSymlink,
    stats,
    mimeType,
    symlinkTarget
  );
}

type GetMultipleFileInfoOptions = FileInfoOptions;

function buildEmptyResult(): GetMultipleFileInfoResult {
  return {
    results: [],
    summary: { total: 0, succeeded: 0, failed: 0, totalSize: 0 },
  };
}

interface ParallelResult {
  index: number;
  value: MultipleFileInfoResult;
}
interface ParallelError {
  index: number;
  error: Error;
}

async function processFileInfo(
  filePath: string,
  options: GetMultipleFileInfoOptions
): Promise<MultipleFileInfoResult> {
  const info = await getFileInfo(filePath, {
    includeMimeType: options.includeMimeType,
    signal: options.signal,
  });

  return { path: filePath, info };
}

async function readFileInfoInParallel(
  paths: readonly string[],
  options: GetMultipleFileInfoOptions
): Promise<{ results: ParallelResult[]; errors: ParallelError[] }> {
  return await processInParallel(
    paths.map((filePath, index) => ({ filePath, index })),
    async ({ filePath, index }) => ({
      index,
      value: await processFileInfo(filePath, options),
    }),
    PARALLEL_CONCURRENCY,
    options.signal
  );
}

function applyResults(
  output: MultipleFileInfoResult[],
  results: ParallelResult[]
): void {
  for (const result of results) {
    output[result.index] = result.value;
  }
}

function applyErrors(
  output: MultipleFileInfoResult[],
  errors: ParallelError[],
  paths: readonly string[]
): void {
  for (const failure of errors) {
    const { index } = failure;
    if (index < 0 || index >= output.length) continue;
    if (output[index] === undefined) continue;

    const filePath = paths[index] ?? '(unknown)';
    output[index] = { path: filePath, error: failure.error.message };
  }
}

function calculateSummary(results: readonly MultipleFileInfoResult[]): {
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
  paths: readonly string[],
  options: GetMultipleFileInfoOptions = {}
): Promise<GetMultipleFileInfoResult> {
  if (paths.length === 0) return buildEmptyResult();

  const output = paths.map((filePath) => ({ path: filePath }));
  const { results, errors } = await readFileInfoInParallel(paths, options);

  applyResults(output, results);
  applyErrors(output, errors, paths);

  return {
    results: output,
    summary: calculateSummary(output),
  };
}
