import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import fg from 'fast-glob';

import type { ListDirectoryResult } from '../../config/types.js';
import {
  DEFAULT_LIST_MAX_ENTRIES,
  DEFAULT_MAX_DEPTH,
  DEFAULT_SEARCH_TIMEOUT_MS,
} from '../constants.js';
import { validateExistingDirectory } from '../path-validation.js';

interface ListDirectoryOptions {
  recursive?: boolean;
  includeHidden?: boolean;
  excludePatterns?: string[];
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
  signal?: AbortSignal;
};

type GlobEntry = fg.Entry;

function normalizeOptions(options: ListDirectoryOptions): NormalizedOptions {
  return {
    recursive: options.recursive ?? false,
    includeHidden: options.includeHidden ?? false,
    excludePatterns: options.excludePatterns ?? [],
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxEntries: options.maxEntries ?? DEFAULT_LIST_MAX_ENTRIES,
    sortBy: options.sortBy ?? 'name',
    includeSymlinkTargets: options.includeSymlinkTargets ?? false,
    pattern:
      options.pattern && options.pattern.length > 0
        ? options.pattern
        : undefined,
    timeoutMs: options.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS,
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

function sortEntries(
  entries: ListDirectoryResult['entries'],
  sortBy: NonNullable<ListDirectoryOptions['sortBy']>
): void {
  const compare = {
    name: (a: (typeof entries)[number], b: (typeof entries)[number]) =>
      a.name.localeCompare(b.name),
    type: (a: (typeof entries)[number], b: (typeof entries)[number]) =>
      a.type.localeCompare(b.type),
    size: (a: (typeof entries)[number], b: (typeof entries)[number]) =>
      (a.size ?? 0) - (b.size ?? 0),
    modified: (a: (typeof entries)[number], b: (typeof entries)[number]) =>
      (a.modified?.getTime() ?? 0) - (b.modified?.getTime() ?? 0),
  }[sortBy];
  entries.sort(compare);
}

async function* toEntries(
  stream: AsyncIterable<GlobEntry | string | Buffer>
): AsyncGenerator<GlobEntry> {
  for await (const item of stream) {
    if (typeof item === 'string' || Buffer.isBuffer(item)) continue;
    yield item;
  }
}

export async function listDirectory(
  dirPath: string,
  options: ListDirectoryOptions = {}
): Promise<ListDirectoryResult> {
  const normalized = normalizeOptions(options);
  const basePath = await validateExistingDirectory(dirPath, options.signal);
  const signal = combineSignals(normalized.signal, normalized.timeoutMs);

  const entries: ListDirectoryResult['entries'] = [];
  let totalFiles = 0;
  let totalDirectories = 0;
  let truncated = false;
  let stoppedReason: ListDirectoryResult['summary']['stoppedReason'];

  const globPattern =
    normalized.pattern ?? (normalized.recursive ? '**/*' : '*');
  const maxDepth = normalized.recursive ? normalized.maxDepth : 1;

  const stream = fg.stream(globPattern, {
    cwd: basePath,
    absolute: true,
    dot: normalized.includeHidden,
    ignore: normalized.excludePatterns,
    onlyFiles: false,
    followSymbolicLinks: false,
    stats: true,
    objectMode: true,
    deep: maxDepth,
  });

  for await (const entry of toEntries(stream)) {
    if (signal?.aborted) {
      truncated = true;
      stoppedReason = 'aborted';
      break;
    }
    if (entries.length >= normalized.maxEntries) {
      truncated = true;
      stoppedReason = 'maxEntries';
      break;
    }

    const relPath =
      path.relative(basePath, entry.path) || path.basename(entry.path);
    const type = entry.dirent.isDirectory()
      ? 'directory'
      : entry.dirent.isSymbolicLink()
        ? 'symlink'
        : entry.dirent.isFile()
          ? 'file'
          : 'other';

    const symlinkTarget =
      type === 'symlink' && normalized.includeSymlinkTargets
        ? await fsp.readlink(entry.path).catch(() => undefined)
        : undefined;

    if (type === 'file') totalFiles++;
    if (type === 'directory') totalDirectories++;

    entries.push({
      name: path.basename(entry.path),
      path: entry.path,
      relativePath: relPath,
      type,
      size: entry.stats?.isFile() ? entry.stats.size : undefined,
      modified: entry.stats?.mtime,
      symlinkTarget,
    });
  }

  sortEntries(entries, normalized.sortBy);

  return {
    path: basePath,
    entries,
    summary: {
      totalEntries: entries.length,
      entriesScanned: entries.length,
      entriesVisible: entries.length,
      totalFiles,
      totalDirectories,
      maxDepthReached: maxDepth,
      truncated,
      stoppedReason,
      skippedInaccessible: 0,
      symlinksNotFollowed: 0,
    },
  };
}
