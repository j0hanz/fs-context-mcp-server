import type { SearchFilesResult } from '../../config/types.js';
import { ErrorCode, McpError } from '../errors.js';
import { safeDestroy } from '../fs-helpers.js';
import { validateExistingDirectory } from '../path-validation.js';
import { validateGlobPatternOrThrow } from './pattern-validator.js';
import {
  buildScanOptions,
  normalizeSearchFilesOptions,
  type SearchFilesOptions,
} from './search-files-options.js';
import {
  buildSearchFilesResult,
  initSearchFilesState,
} from './search-files-state.js';
import { createSearchStream, scanStream } from './search-files-stream.js';

export async function searchFiles(
  basePath: string,
  pattern: string,
  excludePatterns: string[] = [],
  options: SearchFilesOptions = {}
): Promise<SearchFilesResult> {
  const validPath = await validateExistingDirectory(basePath);

  // Validate pattern
  validateGlobPatternOrThrow(pattern, validPath);

  const { signal, ...rest } = options;
  const normalized = normalizeSearchFilesOptions(rest);
  if (!normalized.skipSymlinks) {
    throw new McpError(
      ErrorCode.E_INVALID_INPUT,
      'Following symbolic links is not supported for security reasons',
      basePath
    );
  }

  const state = initSearchFilesState();
  const stream = createSearchStream(
    validPath,
    pattern,
    excludePatterns,
    normalized.maxDepth,
    normalized.baseNameMatch,
    normalized.skipSymlinks,
    normalized.includeHidden
  );

  try {
    await scanStream(stream, state, buildScanOptions(normalized), signal);
  } finally {
    safeDestroy(stream);
  }

  return buildSearchFilesResult(validPath, pattern, state, normalized.sortBy);
}
