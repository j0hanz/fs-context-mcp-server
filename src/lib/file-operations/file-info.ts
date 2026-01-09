import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { Stats } from 'node:fs';

import type {
  FileInfo,
  GetMultipleFileInfoResult,
  MultipleFileInfoResult,
} from '../../config.js';
import { PARALLEL_CONCURRENCY } from '../constants.js';
import { getMimeType } from '../constants.js';
import {
  assertNotAborted,
  getFileType,
  isHidden,
  processInParallel,
  withAbort,
} from '../fs-helpers.js';
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

function getPermissions(mode: number): string {
  const ownerIndex = (mode >> 6) & 0b111;
  const groupIndex = (mode >> 3) & 0b111;
  const otherIndex = mode & 0b111;
  const owner = PERM_STRINGS[ownerIndex] ?? '---';
  const group = PERM_STRINGS[groupIndex] ?? '---';
  const other = PERM_STRINGS[otherIndex] ?? '---';

  return `${owner}${group}${other}`;
}

function resolveMimeType(
  ext: string,
  includeMimeType: boolean
): string | undefined {
  if (!includeMimeType) return undefined;
  if (!ext) return undefined;
  return getMimeType(ext);
}

async function resolveSymlinkTarget(
  pathToRead: string,
  isSymlink: boolean,
  signal?: AbortSignal
): Promise<string | undefined> {
  if (!isSymlink) return undefined;
  return getSymlinkTarget(pathToRead, signal);
}

function buildFileInfoResult(
  name: string,
  requestedPath: string,
  isSymlink: boolean,
  stats: Stats,
  mimeType: string | undefined,
  symlinkTarget: string | undefined
): FileInfo {
  return {
    name,
    path: requestedPath,
    type: isSymlink ? 'symlink' : getFileType(stats),
    size: stats.size,
    created: stats.birthtime,
    modified: stats.mtime,
    accessed: stats.atime,
    permissions: getPermissions(stats.mode),
    isHidden: isHidden(name),
    ...(mimeType !== undefined ? { mimeType } : {}),
    ...(symlinkTarget !== undefined ? { symlinkTarget } : {}),
  };
}

export async function getFileInfo(
  filePath: string,
  options: { includeMimeType?: boolean; signal?: AbortSignal } = {}
): Promise<FileInfo> {
  const { signal } = options;
  assertNotAborted(signal);
  const { requestedPath, resolvedPath, isSymlink } =
    await validateExistingPathDetailed(filePath, signal);

  const name = path.basename(requestedPath);
  const ext = path.extname(name).toLowerCase();
  const includeMimeType = options.includeMimeType !== false;
  const mimeType = resolveMimeType(ext, includeMimeType);
  const symlinkTarget = await resolveSymlinkTarget(
    requestedPath,
    isSymlink,
    signal
  );

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

async function getSymlinkTarget(
  pathToRead: string,
  signal?: AbortSignal
): Promise<string | undefined> {
  assertNotAborted(signal);
  try {
    return await withAbort(fsp.readlink(pathToRead), signal);
  } catch (error) {
    handleSymlinkError(error);
    return undefined;
  }
}

function handleSymlinkError(error: unknown): void {
  if (error instanceof Error && error.name === 'AbortError') {
    throw error;
  }
}

interface GetMultipleFileInfoOptions {
  includeMimeType?: boolean;
  signal?: AbortSignal;
}

function buildEmptyResult(): GetMultipleFileInfoResult {
  return {
    results: [],
    summary: { total: 0, succeeded: 0, failed: 0, totalSize: 0 },
  };
}

function buildOutput(paths: readonly string[]): MultipleFileInfoResult[] {
  return paths.map((filePath) => ({
    path: filePath,
  }));
}

async function processFileInfo(
  filePath: string,
  options: GetMultipleFileInfoOptions
): Promise<MultipleFileInfoResult> {
  const fileInfoOptions: { includeMimeType?: boolean; signal?: AbortSignal } =
    {};
  if (options.includeMimeType !== undefined) {
    fileInfoOptions.includeMimeType = options.includeMimeType;
  }
  if (options.signal) {
    fileInfoOptions.signal = options.signal;
  }
  const info = await getFileInfo(filePath, fileInfoOptions);

  return {
    path: filePath,
    info,
  };
}

async function readFileInfoInParallel(
  paths: readonly string[],
  options: GetMultipleFileInfoOptions
): Promise<{
  results: { index: number; value: MultipleFileInfoResult }[];
  errors: { index: number; error: Error }[];
}> {
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
  results: { index: number; value: MultipleFileInfoResult }[]
): void {
  for (const result of results) {
    output[result.index] = result.value;
  }
}

function applyErrors(
  output: MultipleFileInfoResult[],
  errors: { index: number; error: Error }[],
  paths: readonly string[]
): void {
  for (const failure of errors) {
    const filePath = paths[failure.index] ?? '(unknown)';
    if (output[failure.index] !== undefined) {
      output[failure.index] = { path: filePath, error: failure.error.message };
    }
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

  const output = buildOutput(paths);
  const { results, errors } = await readFileInfoInParallel(paths, options);
  applyResults(output, results);
  applyErrors(output, errors, paths);

  return {
    results: output,
    summary: calculateSummary(output),
  };
}
