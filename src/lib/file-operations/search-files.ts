import * as fs from 'node:fs/promises';

import fg from 'fast-glob';

import type { SearchFilesResult, SearchResult } from '../../config/types.js';
import { DEFAULT_MAX_RESULTS, PARALLEL_CONCURRENCY } from '../constants.js';
import { getFileType } from '../fs-helpers.js';
import {
  validateExistingPath,
  validateExistingPathDetailed,
} from '../path-validation.js';
import { sortSearchResults } from './sorting.js';

interface SearchFilesState {
  results: SearchResult[];
  skippedInaccessible: number;
  truncated: boolean;
  filesScanned: number;
}

function initSearchFilesState(): SearchFilesState {
  return {
    results: [],
    skippedInaccessible: 0,
    truncated: false,
    filesScanned: 0,
  };
}

function markTruncated(state: SearchFilesState): void {
  state.truncated = true;
}

async function toSearchResult(
  match: string
): Promise<SearchResult | { error: Error }> {
  try {
    const { requestedPath, resolvedPath, isSymlink } =
      await validateExistingPathDetailed(match);
    const stats = await fs.stat(resolvedPath);
    return {
      path: requestedPath,
      type: isSymlink ? 'symlink' : getFileType(stats),
      size: stats.isFile() ? stats.size : undefined,
      modified: stats.mtime,
    };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
}

function shouldStop(state: SearchFilesState, maxResults: number): boolean {
  if (state.results.length < maxResults) return false;
  markTruncated(state);
  return true;
}

async function processBatch(
  batch: string[],
  state: SearchFilesState,
  maxResults: number
): Promise<void> {
  if (batch.length === 0 || shouldStop(state, maxResults)) return;

  const toProcess = batch.splice(0, batch.length);
  const settled = await Promise.allSettled(
    toProcess.map(async (match) => toSearchResult(match))
  );

  for (const result of settled) {
    if (shouldStop(state, maxResults)) break;
    if (result.status === 'fulfilled') {
      if ('error' in result.value) {
        state.skippedInaccessible++;
        continue;
      }
      state.results.push(result.value);
    } else {
      state.skippedInaccessible++;
    }
  }
}

async function scanStream(
  stream: AsyncIterable<string | Buffer>,
  state: SearchFilesState,
  maxResults: number
): Promise<void> {
  const batch: string[] = [];

  for await (const entry of stream) {
    if (shouldStop(state, maxResults)) break;
    const matchPath = typeof entry === 'string' ? entry : String(entry);
    state.filesScanned++;

    batch.push(matchPath);
    if (batch.length >= PARALLEL_CONCURRENCY) {
      await processBatch(batch, state, maxResults);
    }
  }

  if (!state.truncated) {
    await processBatch(batch, state, maxResults);
  }
}

function createSearchStream(
  basePath: string,
  pattern: string,
  excludePatterns: string[],
  maxDepth: number | undefined
): AsyncIterable<string | Buffer> {
  return fg.stream(pattern, {
    cwd: basePath,
    absolute: true,
    onlyFiles: true,
    dot: true,
    ignore: excludePatterns,
    suppressErrors: true,
    followSymbolicLinks: false,
    deep: maxDepth,
  });
}

export async function searchFiles(
  basePath: string,
  pattern: string,
  excludePatterns: string[] = [],
  options: {
    maxResults?: number;
    sortBy?: 'name' | 'size' | 'modified' | 'path';
    maxDepth?: number;
  } = {}
): Promise<SearchFilesResult> {
  const validPath = await validateExistingPath(basePath);
  const { maxResults, sortBy = 'path', maxDepth } = options;
  const effectiveMaxResults = maxResults ?? DEFAULT_MAX_RESULTS;

  const state = initSearchFilesState();
  const stream = createSearchStream(
    validPath,
    pattern,
    excludePatterns,
    maxDepth
  );

  try {
    await scanStream(stream, state, effectiveMaxResults);
  } finally {
    const { destroy } = stream as { destroy?: () => void };
    if (typeof destroy === 'function') destroy.call(stream);
  }

  sortSearchResults(state.results, sortBy);

  return {
    basePath: validPath,
    pattern,
    results: state.results,
    summary: {
      matched: state.results.length,
      truncated: state.truncated,
      skippedInaccessible: state.skippedInaccessible,
      filesScanned: state.filesScanned,
    },
  };
}
