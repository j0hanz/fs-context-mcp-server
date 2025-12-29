import fg from 'fast-glob';

import type { SearchFilesResult, SearchResult } from '../../config/types.js';
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_SEARCH_MAX_FILES,
  DEFAULT_SEARCH_TIMEOUT_MS,
} from '../constants.js';
import { validateExistingDirectory } from '../path-validation.js';
import { sortSearchResults } from './sorting.js';

export interface SearchFilesOptions {
  maxResults?: number;
  sortBy?: 'name' | 'size' | 'modified' | 'path';
  maxDepth?: number;
  maxFilesScanned?: number;
  timeoutMs?: number;
  baseNameMatch?: boolean;
  skipSymlinks?: boolean;
  includeHidden?: boolean;
  signal?: AbortSignal;
}

type NormalizedOptions = Required<
  Omit<SearchFilesOptions, 'maxDepth' | 'sortBy' | 'signal'>
> & {
  maxDepth?: number;
  sortBy: NonNullable<SearchFilesOptions['sortBy']>;
  signal?: AbortSignal;
};

type GlobEntry = fg.Entry;

function normalizeOptions(options: SearchFilesOptions): NormalizedOptions {
  return {
    maxResults: options.maxResults ?? DEFAULT_MAX_RESULTS,
    sortBy: options.sortBy ?? 'path',
    maxDepth: options.maxDepth,
    maxFilesScanned: options.maxFilesScanned ?? DEFAULT_SEARCH_MAX_FILES,
    timeoutMs: options.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS,
    baseNameMatch: options.baseNameMatch ?? false,
    skipSymlinks: options.skipSymlinks ?? true,
    includeHidden: options.includeHidden ?? false,
    signal: options.signal,
  };
}

function combineSignals(
  original?: AbortSignal,
  timeoutMs?: number
): AbortSignal | undefined {
  if (!original && !timeoutMs) return undefined;
  const controller = new AbortController();
  const timeoutId =
    typeof timeoutMs === 'number'
      ? setTimeout(() => {
          controller.abort();
        }, timeoutMs)
      : undefined;
  const forward = (): void => {
    controller.abort();
  };
  if (original) {
    if (original.aborted) controller.abort();
    else original.addEventListener('abort', forward, { once: true });
  }
  controller.signal.addEventListener(
    'abort',
    () => {
      if (original) original.removeEventListener('abort', forward);
      if (timeoutId) clearTimeout(timeoutId);
    },
    { once: true }
  );
  return controller.signal;
}

async function* toEntries(
  stream: AsyncIterable<GlobEntry | string | Buffer>
): AsyncGenerator<GlobEntry> {
  for await (const item of stream) {
    if (typeof item === 'string' || Buffer.isBuffer(item)) continue;
    yield item;
  }
}

export async function searchFiles(
  basePath: string,
  pattern: string,
  excludePatterns: string[] = [],
  options: SearchFilesOptions = {}
): Promise<SearchFilesResult> {
  const normalized = normalizeOptions(options);
  const root = await validateExistingDirectory(basePath, options.signal);
  const signal = combineSignals(normalized.signal, normalized.timeoutMs);

  const state: SearchFilesResult['summary'] = {
    matched: 0,
    truncated: false,
    skippedInaccessible: 0,
    filesScanned: 0,
    stoppedReason: undefined,
  };

  const results: SearchResult[] = [];

  const stream = fg.stream(pattern, {
    cwd: root,
    absolute: true,
    dot: normalized.includeHidden,
    followSymbolicLinks: false,
    baseNameMatch: normalized.baseNameMatch,
    caseSensitiveMatch: true,
    ignore: excludePatterns,
    onlyFiles: false,
    stats: true,
    objectMode: true,
    deep: normalized.maxDepth ?? Number.POSITIVE_INFINITY,
  });

  for await (const entry of toEntries(stream)) {
    if (signal?.aborted) {
      state.truncated = true;
      state.stoppedReason = 'timeout';
      break;
    }
    if (state.filesScanned >= normalized.maxFilesScanned) {
      state.truncated = true;
      state.stoppedReason = 'maxFiles';
      break;
    }

    state.filesScanned++;

    const type = entry.dirent.isDirectory()
      ? 'directory'
      : entry.dirent.isSymbolicLink()
        ? 'symlink'
        : entry.dirent.isFile()
          ? 'file'
          : 'other';

    if (normalized.skipSymlinks && type === 'symlink') {
      continue;
    }

    results.push({
      path: entry.path,
      type:
        type === 'directory' ? 'directory' : type === 'file' ? 'file' : 'other',
      size: entry.stats?.isFile() ? entry.stats.size : undefined,
      modified: entry.stats?.mtime,
    });

    if (results.length >= normalized.maxResults) {
      state.truncated = true;
      state.stoppedReason = 'maxResults';
      break;
    }
  }

  sortSearchResults(results, normalized.sortBy);
  state.matched = results.length;

  return {
    basePath: root,
    pattern,
    results,
    summary: state,
  };
}
