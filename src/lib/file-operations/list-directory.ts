import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { Stats } from 'node:fs';

import type { DirectoryEntry, ListDirectoryResult } from '../../config.js';
import {
  DEFAULT_LIST_MAX_ENTRIES,
  DEFAULT_MAX_DEPTH,
  DEFAULT_SEARCH_TIMEOUT_MS,
  PARALLEL_CONCURRENCY,
} from '../constants.js';
import { createTimedAbortSignal, withAbort } from '../fs-helpers.js';
import { isSensitivePath } from '../path-policy.js';
import {
  validateExistingDirectory,
  validateExistingPathDetailed,
} from '../path-validation.js';
import { globEntries } from './glob-engine.js';

export interface ListDirectoryOptions {
  includeHidden?: boolean;
  excludePatterns?: readonly string[];
  maxDepth?: number;
  maxEntries?: number;
  sortBy?: 'name' | 'size' | 'modified' | 'type';
  includeSymlinkTargets?: boolean;
  pattern?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

type NormalizedOptions = Required<
  Omit<ListDirectoryOptions, 'signal' | 'pattern'>
> & {
  pattern?: string;
};

interface EntryTotals {
  files: number;
  directories: number;
}

interface EntryCandidate {
  path: string;
  dirent: {
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    isFile(): boolean;
  };
  stats?: Stats;
}

interface SymlinkOptions {
  includeSymlinkTargets: boolean;
}

function normalizePattern(pattern: string | undefined): string | undefined {
  if (!pattern || pattern.length === 0) return undefined;
  return pattern;
}

function normalizeOptions(options: ListDirectoryOptions): NormalizedOptions {
  const pattern = normalizePattern(options.pattern);
  const normalized: NormalizedOptions = {
    includeHidden: options.includeHidden ?? false,
    excludePatterns: options.excludePatterns ?? [],
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxEntries: options.maxEntries ?? DEFAULT_LIST_MAX_ENTRIES,
    sortBy: options.sortBy ?? 'name',
    includeSymlinkTargets: options.includeSymlinkTargets ?? false,
    timeoutMs: options.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS,
  };
  if (pattern !== undefined) {
    normalized.pattern = pattern;
  }
  return normalized;
}

function sortEntries(
  entries: DirectoryEntry[],
  sortBy: NonNullable<ListDirectoryOptions['sortBy']>
): void {
  const compare = {
    name: (a: DirectoryEntry, b: DirectoryEntry) =>
      a.name.localeCompare(b.name),
    type: (a: DirectoryEntry, b: DirectoryEntry) =>
      a.type.localeCompare(b.type),
    size: (a: DirectoryEntry, b: DirectoryEntry) =>
      (a.size ?? 0) - (b.size ?? 0),
    modified: (a: DirectoryEntry, b: DirectoryEntry) =>
      (a.modified?.getTime() ?? 0) - (b.modified?.getTime() ?? 0),
  }[sortBy];
  entries.sort(compare);
}

function needsStatsForSort(sortBy: NormalizedOptions['sortBy']): boolean {
  return sortBy === 'size' || sortBy === 'modified';
}

function resolveMaxDepth(normalized: NormalizedOptions): number {
  if (!normalized.pattern) {
    return 1;
  }
  return normalized.maxDepth;
}

function shouldStopScan(
  signal: AbortSignal,
  entryCount: number,
  maxEntries: number
): { stop: boolean; reason?: ListDirectoryResult['summary']['stoppedReason'] } {
  if (signal.aborted) {
    return { stop: true, reason: 'aborted' };
  }
  if (entryCount >= maxEntries) {
    return { stop: true, reason: 'maxEntries' };
  }
  return { stop: false };
}

async function* readDirectoryEntries(
  basePath: string,
  normalized: NormalizedOptions,
  needsStats: boolean,
  signal: AbortSignal
): AsyncGenerator<EntryCandidate> {
  const dirents = await withAbort(
    fsp.readdir(basePath, { withFileTypes: true }),
    signal
  );

  for (const dirent of dirents) {
    if (!normalized.includeHidden && dirent.name.startsWith('.')) {
      continue;
    }

    const entryPath = path.join(basePath, dirent.name);
    let stats: Stats | undefined;
    if (needsStats) {
      stats = await withAbort(fsp.lstat(entryPath), signal);
    }
    yield {
      path: entryPath,
      dirent,
      ...(stats ? { stats } : {}),
    };
  }
}

function createEntryStream(
  basePath: string,
  normalized: NormalizedOptions,
  maxDepth: number,
  needsStats: boolean,
  signal: AbortSignal
): AsyncIterable<EntryCandidate> {
  const canUseFastPath =
    !normalized.pattern &&
    normalized.excludePatterns.length === 0 &&
    maxDepth === 1;
  if (canUseFastPath) {
    return readDirectoryEntries(basePath, normalized, needsStats, signal);
  }
  return globEntries({
    cwd: basePath,
    pattern: normalized.pattern ?? '*',
    excludePatterns: normalized.excludePatterns,
    includeHidden: normalized.includeHidden,
    baseNameMatch: false,
    caseSensitiveMatch: true,
    maxDepth,
    followSymbolicLinks: false,
    onlyFiles: false,
    stats: needsStats,
  });
}

function resolveEntryType(
  dirent: EntryCandidate['dirent']
): DirectoryEntry['type'] {
  if (dirent.isDirectory()) return 'directory';
  if (dirent.isSymbolicLink()) return 'symlink';
  if (dirent.isFile()) return 'file';
  return 'other';
}

function resolveRelativePath(basePath: string, entryPath: string): string {
  return path.relative(basePath, entryPath) || path.basename(entryPath);
}

async function resolveSymlinkTarget(
  entryType: DirectoryEntry['type'],
  includeSymlinkTargets: boolean,
  entryPath: string
): Promise<string | undefined> {
  if (entryType !== 'symlink' || !includeSymlinkTargets) {
    return undefined;
  }
  return await fsp.readlink(entryPath).catch(() => undefined);
}

function updateTotals(type: DirectoryEntry['type'], totals: EntryTotals): void {
  if (type === 'file') totals.files += 1;
  if (type === 'directory') totals.directories += 1;
}

function buildDirectoryEntry(
  basePath: string,
  entry: { path: string; stats?: Stats },
  entryType: DirectoryEntry['type'],
  needsStats: boolean,
  symlinkTarget: string | undefined
): DirectoryEntry {
  const size =
    needsStats && entry.stats?.isFile() ? entry.stats.size : undefined;
  const modified = needsStats ? entry.stats?.mtime : undefined;
  return {
    name: path.basename(entry.path),
    path: entry.path,
    relativePath: resolveRelativePath(basePath, entry.path),
    type: entryType,
    ...(size !== undefined ? { size } : {}),
    ...(modified !== undefined ? { modified } : {}),
    ...(symlinkTarget !== undefined ? { symlinkTarget } : {}),
  };
}

function trackSymlink(
  entryType: DirectoryEntry['type'],
  includeSymlinkTargets: boolean,
  counters: { symlinksNotFollowed: number }
): void {
  if (entryType === 'symlink' && !includeSymlinkTargets) {
    counters.symlinksNotFollowed += 1;
  }
}

async function isEntryAccessible(
  entryPath: string,
  signal: AbortSignal,
  counters: { skippedInaccessible: number }
): Promise<boolean> {
  try {
    const validated = await validateExistingPathDetailed(entryPath, signal);
    if (isSensitivePath(validated.requestedPath, validated.resolvedPath)) {
      counters.skippedInaccessible += 1;
      return false;
    }
    return true;
  } catch {
    counters.skippedInaccessible += 1;
    return false;
  }
}

async function appendEntryWithQueue(
  basePath: string,
  entry: EntryCandidate,
  normalized: NormalizedOptions,
  needsStats: boolean,
  totals: EntryTotals,
  entries: DirectoryEntry[],
  pending: Promise<void>[],
  flushPending: () => Promise<void>
): Promise<void> {
  const task = appendEntry(
    basePath,
    entry,
    normalized,
    needsStats,
    totals,
    entries
  );
  if (normalized.includeSymlinkTargets) {
    pending.push(task);
    if (pending.length >= PARALLEL_CONCURRENCY) {
      await flushPending();
    }
    return;
  }
  await task;
}

async function appendEntry(
  basePath: string,
  entry: EntryCandidate,
  options: SymlinkOptions,
  needsStats: boolean,
  totals: EntryTotals,
  entries: DirectoryEntry[]
): Promise<void> {
  const entryType = resolveEntryType(entry.dirent);
  const symlinkTarget = await resolveSymlinkTarget(
    entryType,
    options.includeSymlinkTargets,
    entry.path
  );
  updateTotals(entryType, totals);
  entries.push(
    buildDirectoryEntry(basePath, entry, entryType, needsStats, symlinkTarget)
  );
}

function buildSummary(
  entries: DirectoryEntry[],
  totals: EntryTotals,
  maxDepth: number,
  truncated: boolean,
  stoppedReason: ListDirectoryResult['summary']['stoppedReason'] | undefined,
  extra: { skippedInaccessible: number; symlinksNotFollowed: number }
): ListDirectoryResult['summary'] {
  const baseSummary: ListDirectoryResult['summary'] = {
    totalEntries: entries.length,
    entriesScanned: entries.length,
    entriesVisible: entries.length,
    totalFiles: totals.files,
    totalDirectories: totals.directories,
    maxDepthReached: maxDepth,
    truncated,
    skippedInaccessible: extra.skippedInaccessible,
    symlinksNotFollowed: extra.symlinksNotFollowed,
  };
  return {
    ...baseSummary,
    ...(stoppedReason !== undefined ? { stoppedReason } : {}),
  };
}

async function collectEntries(
  basePath: string,
  normalized: NormalizedOptions,
  signal: AbortSignal,
  needsStats: boolean,
  maxDepth: number
): Promise<{
  entries: DirectoryEntry[];
  totals: EntryTotals;
  truncated: boolean;
  stoppedReason: ListDirectoryResult['summary']['stoppedReason'] | undefined;
  skippedInaccessible: number;
  symlinksNotFollowed: number;
}> {
  const entries: DirectoryEntry[] = [];
  const totals: EntryTotals = { files: 0, directories: 0 };
  let truncated = false;
  let stoppedReason:
    | ListDirectoryResult['summary']['stoppedReason']
    | undefined;
  const counters = { skippedInaccessible: 0, symlinksNotFollowed: 0 };
  const pending: Promise<void>[] = [];
  let scheduledCount = 0;

  const stream = createEntryStream(
    basePath,
    normalized,
    maxDepth,
    needsStats,
    signal
  );

  const flushPending = async (): Promise<void> => {
    if (pending.length === 0) return;
    await Promise.allSettled(pending.splice(0));
  };

  for await (const entry of stream) {
    const stop = shouldStopScan(signal, scheduledCount, normalized.maxEntries);
    if (stop.stop) {
      truncated = true;
      stoppedReason = stop.reason;
      break;
    }

    const entryType = resolveEntryType(entry.dirent);
    trackSymlink(entryType, normalized.includeSymlinkTargets, counters);

    const accessible = await isEntryAccessible(entry.path, signal, counters);
    if (!accessible) {
      continue;
    }

    scheduledCount += 1;
    await appendEntryWithQueue(
      basePath,
      entry,
      normalized,
      needsStats,
      totals,
      entries,
      pending,
      flushPending
    );
  }

  if (normalized.includeSymlinkTargets) {
    await flushPending();
  }

  return {
    entries,
    totals,
    truncated,
    stoppedReason,
    skippedInaccessible: counters.skippedInaccessible,
    symlinksNotFollowed: counters.symlinksNotFollowed,
  };
}

async function executeListDirectory(
  basePath: string,
  normalized: NormalizedOptions,
  signal: AbortSignal
): Promise<{
  entries: DirectoryEntry[];
  summary: ListDirectoryResult['summary'];
}> {
  const needsStats = needsStatsForSort(normalized.sortBy);
  const maxDepth = resolveMaxDepth(normalized);
  const {
    entries,
    totals,
    truncated,
    stoppedReason,
    skippedInaccessible,
    symlinksNotFollowed,
  } = await collectEntries(basePath, normalized, signal, needsStats, maxDepth);

  sortEntries(entries, normalized.sortBy);

  return {
    entries,
    summary: buildSummary(entries, totals, maxDepth, truncated, stoppedReason, {
      skippedInaccessible,
      symlinksNotFollowed,
    }),
  };
}

export async function listDirectory(
  dirPath: string,
  options: ListDirectoryOptions = {}
): Promise<ListDirectoryResult> {
  const normalized = normalizeOptions(options);
  const { signal, cleanup } = createTimedAbortSignal(
    options.signal,
    normalized.timeoutMs
  );
  const basePath = await validateExistingDirectory(dirPath, signal);

  try {
    const { entries, summary } = await executeListDirectory(
      basePath,
      normalized,
      signal
    );
    return { path: basePath, entries, summary };
  } finally {
    cleanup();
  }
}
