import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';

import type {
  DirectoryEntry,
  ListDirectoryResult,
} from '../../config/types.js';
import {
  DEFAULT_MAX_DEPTH,
  DIR_TRAVERSAL_CONCURRENCY,
  PARALLEL_CONCURRENCY,
} from '../constants.js';
import { isHidden, processInParallel, runWorkQueue } from '../fs-helpers.js';
import { validateExistingPath } from '../path-validation.js';
import {
  buildDirectoryItemResult,
  type DirectoryItemResult,
} from './directory-items.js';
import { sortByField } from './sorting.js';

interface ListDirectoryState {
  entries: DirectoryEntry[];
  totalFiles: number;
  totalDirectories: number;
  maxDepthReached: number;
  truncated: boolean;
  skippedInaccessible: number;
  symlinksNotFollowed: number;
}

interface ListDirectoryConfig {
  basePath: string;
  recursive: boolean;
  includeHidden: boolean;
  maxDepth: number;
  maxEntries?: number;
  includeSymlinkTargets: boolean;
}

function initListState(): ListDirectoryState {
  return {
    entries: [],
    totalFiles: 0,
    totalDirectories: 0,
    maxDepthReached: 0,
    truncated: false,
    skippedInaccessible: 0,
    symlinksNotFollowed: 0,
  };
}

function createStopChecker(
  maxEntries: number | undefined,
  state: ListDirectoryState
): () => boolean {
  return (): boolean => {
    if (maxEntries !== undefined && state.entries.length >= maxEntries) {
      state.truncated = true;
      return true;
    }
    return false;
  };
}

async function readVisibleItems(
  currentPath: string,
  includeHidden: boolean
): Promise<Dirent[] | null> {
  try {
    const items = await fs.readdir(currentPath, { withFileTypes: true });
    return includeHidden ? items : items.filter((item) => !isHidden(item.name));
  } catch {
    return null;
  }
}

function applyDirectoryItemResult(
  result: DirectoryItemResult,
  state: ListDirectoryState,
  enqueue: (entry: { currentPath: string; depth: number }) => void
): void {
  const { entry, enqueueDir, skippedInaccessible, symlinkNotFollowed } = result;

  state.entries.push(entry);
  if (entry.type === 'directory') state.totalDirectories++;
  if (entry.type === 'file') state.totalFiles++;
  if (enqueueDir) enqueue(enqueueDir);
  if (skippedInaccessible) state.skippedInaccessible++;
  if (symlinkNotFollowed) state.symlinksNotFollowed++;
}

function processResults(
  results: DirectoryItemResult[],
  state: ListDirectoryState,
  enqueue: (entry: { currentPath: string; depth: number }) => void,
  shouldStop: () => boolean
): void {
  for (const result of results) {
    if (shouldStop()) break;
    applyDirectoryItemResult(result, state, enqueue);
  }
}

async function handleDirectory(
  params: { currentPath: string; depth: number },
  enqueue: (entry: { currentPath: string; depth: number }) => void,
  config: ListDirectoryConfig,
  state: ListDirectoryState,
  shouldStop: () => boolean
): Promise<void> {
  if (params.depth > config.maxDepth) return;
  if (shouldStop()) return;

  state.maxDepthReached = Math.max(state.maxDepthReached, params.depth);

  const items = await readVisibleItems(
    params.currentPath,
    config.includeHidden
  );
  if (!items) {
    state.skippedInaccessible++;
    return;
  }

  const { results, errors } = await processInParallel(
    items,
    async (item) =>
      buildDirectoryItemResult(item, params.currentPath, config.basePath, {
        includeSymlinkTargets: config.includeSymlinkTargets,
        recursive: config.recursive,
        depth: params.depth,
        maxDepth: config.maxDepth,
      }),
    PARALLEL_CONCURRENCY
  );

  state.skippedInaccessible += errors.length;
  processResults(results, state, enqueue, shouldStop);
}

export async function listDirectory(
  dirPath: string,
  options: {
    recursive?: boolean;
    includeHidden?: boolean;
    maxDepth?: number;
    maxEntries?: number;
    sortBy?: 'name' | 'size' | 'modified' | 'type';
    includeSymlinkTargets?: boolean;
  } = {}
): Promise<ListDirectoryResult> {
  const {
    recursive = false,
    includeHidden = false,
    maxDepth = DEFAULT_MAX_DEPTH,
    maxEntries,
    sortBy = 'name',
    includeSymlinkTargets = false,
  } = options;

  const basePath = await validateExistingPath(dirPath);
  const state = initListState();
  const shouldStop = createStopChecker(maxEntries, state);
  const config: ListDirectoryConfig = {
    basePath,
    recursive,
    includeHidden,
    maxDepth,
    maxEntries,
    includeSymlinkTargets,
  };

  await runWorkQueue<{ currentPath: string; depth: number }>(
    [{ currentPath: basePath, depth: 0 }],
    async (params, enqueue) =>
      handleDirectory(params, enqueue, config, state, shouldStop),
    DIR_TRAVERSAL_CONCURRENCY
  );

  sortByField(state.entries, sortBy);

  return {
    path: basePath,
    entries: state.entries,
    summary: {
      totalEntries: state.entries.length,
      totalFiles: state.totalFiles,
      totalDirectories: state.totalDirectories,
      maxDepthReached: state.maxDepthReached,
      truncated: state.truncated,
      skippedInaccessible: state.skippedInaccessible,
      symlinksNotFollowed: state.symlinksNotFollowed,
    },
  };
}
