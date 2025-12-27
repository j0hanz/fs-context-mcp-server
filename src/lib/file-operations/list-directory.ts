import type { ListDirectoryResult } from '../../config/types.js';
import {
  DEFAULT_LIST_MAX_ENTRIES,
  DEFAULT_MAX_DEPTH,
  DIR_TRAVERSAL_CONCURRENCY,
} from '../constants.js';
import { runWorkQueue } from '../fs-helpers.js';
import { mergeDefined } from '../merge-defined.js';
import { validateExistingDirectory } from '../path-validation.js';
import {
  buildExcludeMatchers,
  buildPatternMatcher,
  createStopChecker,
  handleDirectory,
  initListState,
  type ListDirectoryConfig,
} from './list-directory-helpers.js';
import { sortByField } from './sorting.js';

interface ListDirectoryOptions {
  recursive?: boolean;
  includeHidden?: boolean;
  excludePatterns?: string[];
  maxDepth?: number;
  maxEntries?: number;
  sortBy?: 'name' | 'size' | 'modified' | 'type';
  includeSymlinkTargets?: boolean;
  pattern?: string;
  signal?: AbortSignal;
}

type NormalizedListDirectoryOptions = Required<
  Omit<ListDirectoryOptions, 'signal'>
>;

function normalizeListDirectoryOptions(
  options: Omit<ListDirectoryOptions, 'signal'>
): NormalizedListDirectoryOptions {
  const defaults: NormalizedListDirectoryOptions = {
    recursive: false,
    includeHidden: false,
    excludePatterns: [],
    maxDepth: DEFAULT_MAX_DEPTH,
    maxEntries: DEFAULT_LIST_MAX_ENTRIES,
    sortBy: 'name',
    includeSymlinkTargets: false,
    pattern: '',
  };
  return mergeDefined(defaults, options);
}

function buildSummary(
  state: ReturnType<typeof initListState>
): ListDirectoryResult['summary'] {
  return {
    totalEntries: state.entries.length,
    totalFiles: state.totalFiles,
    totalDirectories: state.totalDirectories,
    maxDepthReached: state.maxDepthReached,
    truncated: state.truncated,
    stoppedReason: state.stoppedReason,
    skippedInaccessible: state.skippedInaccessible,
    symlinksNotFollowed: state.symlinksNotFollowed,
    entriesScanned: state.entriesScanned,
    entriesVisible: state.entriesVisible,
  };
}

export async function listDirectory(
  dirPath: string,
  options: ListDirectoryOptions = {}
): Promise<ListDirectoryResult> {
  const { signal, ...rest } = options;
  const normalized = normalizeListDirectoryOptions(rest);

  const basePath = await validateExistingDirectory(dirPath);
  const state = initListState();
  const shouldStop = createStopChecker(normalized.maxEntries, state, signal);
  const excludeMatchers = buildExcludeMatchers(normalized.excludePatterns);
  const patternMatcher = buildPatternMatcher(normalized.pattern);
  const config: ListDirectoryConfig = {
    basePath,
    recursive: normalized.recursive,
    includeHidden: normalized.includeHidden,
    excludePatterns: normalized.excludePatterns,
    excludeMatchers,
    maxDepth: normalized.maxDepth,
    maxEntries: normalized.maxEntries,
    includeSymlinkTargets: normalized.includeSymlinkTargets,
    pattern: normalized.pattern,
    patternMatcher,
    signal,
  };

  await runWorkQueue<{ currentPath: string; depth: number }>(
    [{ currentPath: basePath, depth: 0 }],
    async (params, enqueue) =>
      handleDirectory(params, enqueue, config, state, shouldStop),
    DIR_TRAVERSAL_CONCURRENCY,
    signal
  );

  sortByField(state.entries, normalized.sortBy);

  return {
    path: basePath,
    entries: state.entries,
    summary: buildSummary(state),
  };
}
