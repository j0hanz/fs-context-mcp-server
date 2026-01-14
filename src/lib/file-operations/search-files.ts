import * as path from 'node:path';
import type { Stats } from 'node:fs';

import type { SearchFilesResult, SearchResult } from '../../config.js';
import {
  DEFAULT_SEARCH_MAX_FILES,
  DEFAULT_SEARCH_TIMEOUT_MS,
} from '../constants.js';
import { createTimedAbortSignal } from '../fs-helpers.js';
import { validateExistingDirectory } from '../path-validation.js';
import { isIgnoredByGitignore, loadRootGitignore } from './gitignore.js';
import { globEntries } from './glob-engine.js';

// Internal default for find tool - not exposed to MCP users
const INTERNAL_MAX_RESULTS = 1000;

export interface SearchFilesOptions {
  maxResults?: number;
  sortBy?: 'name' | 'size' | 'modified' | 'path';
  maxDepth?: number;
  maxFilesScanned?: number;
  timeoutMs?: number;
  baseNameMatch?: boolean;
  skipSymlinks?: boolean;
  includeHidden?: boolean;
  respectGitignore?: boolean;
  signal?: AbortSignal;
}

type NormalizedOptions = Required<
  Omit<SearchFilesOptions, 'maxDepth' | 'sortBy' | 'signal'>
> & {
  maxDepth?: number;
  sortBy: NonNullable<SearchFilesOptions['sortBy']>;
};

function normalizeOptions(options: SearchFilesOptions): NormalizedOptions {
  const normalized: NormalizedOptions = {
    maxResults: options.maxResults ?? INTERNAL_MAX_RESULTS,
    sortBy: options.sortBy ?? 'path',
    maxFilesScanned: options.maxFilesScanned ?? DEFAULT_SEARCH_MAX_FILES,
    timeoutMs: options.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS,
    baseNameMatch: options.baseNameMatch ?? false,
    skipSymlinks: options.skipSymlinks ?? true,
    includeHidden: options.includeHidden ?? false,
    respectGitignore: options.respectGitignore ?? false,
  };
  if (options.maxDepth !== undefined) {
    normalized.maxDepth = options.maxDepth;
  }
  return normalized;
}

type SearchEntryType = 'directory' | 'symlink' | 'file' | 'other';

interface SearchEntry {
  path: string;
  dirent: {
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    isFile(): boolean;
  };
  stats?: Stats;
}

interface CollectState {
  results: SearchResult[];
  filesScanned: number;
  truncated: boolean;
  stoppedReason?: SearchFilesResult['summary']['stoppedReason'];
}

function resolveEntryType(dirent: SearchEntry['dirent']): SearchEntryType {
  if (dirent.isDirectory()) return 'directory';
  if (dirent.isSymbolicLink()) return 'symlink';
  if (dirent.isFile()) return 'file';
  return 'other';
}

function buildSearchResult(
  entry: { path: string; stats?: Stats },
  entryType: SearchEntryType,
  needsStats: boolean
): SearchResult {
  let resolvedType: SearchResult['type'] = 'other';
  if (entryType === 'directory') {
    resolvedType = 'directory';
  } else if (entryType === 'file') {
    resolvedType = 'file';
  }
  const size =
    needsStats && entry.stats?.isFile() ? entry.stats.size : undefined;
  const modified = needsStats ? entry.stats?.mtime : undefined;
  return {
    path: entry.path,
    type: resolvedType,
    ...(size !== undefined ? { size } : {}),
    ...(modified !== undefined ? { modified } : {}),
  };
}

function needsStatsForSort(sortBy: NormalizedOptions['sortBy']): boolean {
  return sortBy === 'size' || sortBy === 'modified';
}

function markStopped(
  state: CollectState,
  reason: SearchFilesResult['summary']['stoppedReason']
): void {
  state.truncated = true;
  state.stoppedReason = reason;
}

function shouldStopCollecting(
  state: CollectState,
  normalized: NormalizedOptions,
  signal: AbortSignal
): boolean {
  if (signal.aborted) {
    markStopped(state, 'timeout');
    return true;
  }
  if (state.filesScanned >= normalized.maxFilesScanned) {
    markStopped(state, 'maxFiles');
    return true;
  }
  return false;
}

function shouldIncludeEntry(
  entryType: SearchEntryType,
  normalized: NormalizedOptions
): boolean {
  return !normalized.skipSymlinks || entryType !== 'symlink';
}

function createCollectState(): CollectState {
  return {
    results: [],
    filesScanned: 0,
    truncated: false,
  };
}

function buildSearchStream(
  root: string,
  pattern: string,
  excludePatterns: readonly string[],
  normalized: NormalizedOptions,
  needsStats: boolean
): AsyncIterable<SearchEntry> {
  const options: Parameters<typeof globEntries>[0] = {
    cwd: root,
    pattern,
    excludePatterns,
    includeHidden: normalized.includeHidden,
    baseNameMatch: normalized.baseNameMatch,
    caseSensitiveMatch: true,
    followSymbolicLinks: false,
    onlyFiles: true,
    stats: needsStats,
  };
  if (normalized.maxDepth !== undefined) {
    options.maxDepth = normalized.maxDepth;
  }
  return globEntries(options);
}

function buildCollectResult(state: CollectState): {
  results: SearchResult[];
  filesScanned: number;
  truncated: boolean;
  stoppedReason?: SearchFilesResult['summary']['stoppedReason'];
} {
  const baseResult = {
    results: state.results,
    filesScanned: state.filesScanned,
    truncated: state.truncated,
  };
  return {
    ...baseResult,
    ...(state.stoppedReason !== undefined
      ? { stoppedReason: state.stoppedReason }
      : {}),
  };
}

function handleEntry(
  entry: SearchEntry,
  entryType: SearchEntryType,
  needsStats: boolean,
  normalized: NormalizedOptions,
  state: CollectState
): void {
  if (!shouldIncludeEntry(entryType, normalized)) return;
  state.results.push(buildSearchResult(entry, entryType, needsStats));
  if (state.results.length >= normalized.maxResults) {
    markStopped(state, 'maxResults');
  }
}

async function collectFromStream(
  stream: AsyncIterable<SearchEntry>,
  root: string,
  gitignoreMatcher: Awaited<ReturnType<typeof loadRootGitignore>>,
  normalized: NormalizedOptions,
  needsStats: boolean,
  state: CollectState,
  signal: AbortSignal
): Promise<void> {
  for await (const entry of stream) {
    if (shouldStopCollecting(state, normalized, signal)) break;
    state.filesScanned++;

    if (
      gitignoreMatcher &&
      isIgnoredByGitignore(gitignoreMatcher, root, entry.path)
    ) {
      continue;
    }

    handleEntry(
      entry,
      resolveEntryType(entry.dirent),
      needsStats,
      normalized,
      state
    );
    if (state.truncated) break;
  }
}

async function collectSearchResults(
  root: string,
  pattern: string,
  excludePatterns: readonly string[],
  normalized: NormalizedOptions,
  signal: AbortSignal
): Promise<{
  results: SearchResult[];
  filesScanned: number;
  truncated: boolean;
  stoppedReason?: SearchFilesResult['summary']['stoppedReason'];
}> {
  const needsStats = needsStatsForSort(normalized.sortBy);
  const stream = buildSearchStream(
    root,
    pattern,
    excludePatterns,
    normalized,
    needsStats
  );
  const state = createCollectState();

  const gitignoreMatcher = normalized.respectGitignore
    ? await loadRootGitignore(root, signal)
    : null;

  await collectFromStream(
    stream,
    root,
    gitignoreMatcher,
    normalized,
    needsStats,
    state,
    signal
  );
  return buildCollectResult(state);
}

function buildSearchSummary(
  results: SearchResult[],
  filesScanned: number,
  truncated: boolean,
  stoppedReason: SearchFilesResult['summary']['stoppedReason'] | undefined
): SearchFilesResult['summary'] {
  const baseSummary: SearchFilesResult['summary'] = {
    matched: results.length,
    truncated,
    skippedInaccessible: 0,
    filesScanned,
  };
  return {
    ...baseSummary,
    ...(stoppedReason !== undefined ? { stoppedReason } : {}),
  };
}

type SortKey = 'name' | 'size' | 'modified' | 'path';

interface Sortable {
  name?: string;
  size?: number;
  modified?: Date;
  path?: string;
}

function compareString(a?: string, b?: string): number {
  return (a ?? '').localeCompare(b ?? '');
}

function compareNameThenPath(a: Sortable, b: Sortable): number {
  const nameCompare = compareString(a.name, b.name);
  if (nameCompare !== 0) return nameCompare;
  return compareString(a.path, b.path);
}

function comparePathThenName(a: Sortable, b: Sortable): number {
  const pathCompare = compareString(a.path, b.path);
  if (pathCompare !== 0) return pathCompare;
  return compareString(a.name, b.name);
}

function compareOptionalNumberDesc(
  left: number | undefined,
  right: number | undefined,
  tieBreak: () => number
): number {
  const diff = (right ?? 0) - (left ?? 0);
  if (diff !== 0) return diff;
  return tieBreak();
}

const SORT_COMPARATORS: Readonly<
  Record<SortKey, (a: Sortable, b: Sortable) => number>
> = {
  size: (a, b) =>
    compareOptionalNumberDesc(a.size, b.size, () => compareNameThenPath(a, b)),
  modified: (a, b) =>
    compareOptionalNumberDesc(
      a.modified?.getTime(),
      b.modified?.getTime(),
      () => compareNameThenPath(a, b)
    ),
  path: (a, b) => comparePathThenName(a, b),
  name: (a, b) => compareNameThenPath(a, b),
};

export function sortSearchResults(
  results: Sortable[],
  sortBy: 'name' | 'size' | 'modified' | 'path'
): void {
  if (sortBy === 'name') {
    const decorated = results.map((item, index) => ({
      item,
      baseName: path.basename(item.path ?? ''),
      index,
    }));
    decorated.sort((a, b) => {
      const baseCompare = compareString(a.baseName, b.baseName);
      if (baseCompare !== 0) return baseCompare;
      const pathCompare = compareString(a.item.path, b.item.path);
      if (pathCompare !== 0) return pathCompare;
      return a.index - b.index;
    });
    results.splice(0, results.length, ...decorated.map((entry) => entry.item));
    return;
  }

  const comparator = SORT_COMPARATORS[sortBy];
  results.sort(comparator);
}

async function runSearchFiles(
  root: string,
  pattern: string,
  excludePatterns: readonly string[],
  normalized: NormalizedOptions,
  signal: AbortSignal
): Promise<{ results: SearchResult[]; summary: SearchFilesResult['summary'] }> {
  const { results, filesScanned, truncated, stoppedReason } =
    await collectSearchResults(
      root,
      pattern,
      excludePatterns,
      normalized,
      signal
    );

  sortSearchResults(results, normalized.sortBy);

  return {
    results,
    summary: buildSearchSummary(
      results,
      filesScanned,
      truncated,
      stoppedReason
    ),
  };
}

export async function searchFiles(
  basePath: string,
  pattern: string,
  excludePatterns: readonly string[] = [],
  options: SearchFilesOptions = {}
): Promise<SearchFilesResult> {
  const normalized = normalizeOptions(options);
  const { signal, cleanup } = createTimedAbortSignal(
    options.signal,
    normalized.timeoutMs
  );
  const root = await validateExistingDirectory(basePath, signal);

  try {
    const { results, summary } = await runSearchFiles(
      root,
      pattern,
      excludePatterns,
      normalized,
      signal
    );

    return {
      basePath: root,
      pattern,
      results,
      summary,
    };
  } finally {
    cleanup();
  }
}
