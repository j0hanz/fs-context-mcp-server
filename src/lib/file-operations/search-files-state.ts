import type { SearchFilesResult, SearchResult } from '../../config/types.js';
import type { SearchFilesOptions } from './search-files-options.js';
import { sortSearchResults } from './sorting.js';

export interface SearchFilesState {
  results: SearchResult[];
  skippedInaccessible: number;
  truncated: boolean;
  filesScanned: number;
  stoppedReason?: SearchFilesResult['summary']['stoppedReason'];
}

export function initSearchFilesState(): SearchFilesState {
  return {
    results: [],
    skippedInaccessible: 0,
    truncated: false,
    filesScanned: 0,
    stoppedReason: undefined,
  };
}

export function buildSearchFilesResult(
  basePath: string,
  pattern: string,
  state: SearchFilesState,
  sortBy: SearchFilesOptions['sortBy']
): SearchFilesResult {
  sortSearchResults(state.results, sortBy ?? 'path');
  return {
    basePath,
    pattern,
    results: state.results,
    summary: {
      matched: state.results.length,
      truncated: state.truncated,
      skippedInaccessible: state.skippedInaccessible,
      filesScanned: state.filesScanned,
      stoppedReason: state.stoppedReason,
    },
  };
}
