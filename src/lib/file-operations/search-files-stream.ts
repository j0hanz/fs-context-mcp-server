import fg from 'fast-glob';

import { safeDestroy } from '../fs-helpers.js';
import type { SearchFilesState } from './search-files-state.js';
import {
  drainStream,
  handleScanError,
  markStopped,
  throwIfAborted,
} from './search-files-stream-processor.js';
import type { ScanStreamOptions } from './search-files-stream-types.js';
import { createStreamAbortController } from './stream-control.js';

export type { ScanStreamOptions } from './search-files-stream-types.js';

export async function scanStream(
  stream: AsyncIterable<string | Buffer>,
  state: SearchFilesState,
  options: ScanStreamOptions,
  signal?: AbortSignal
): Promise<void> {
  const batch: string[] = [];

  const destroyStream = (): void => {
    safeDestroy(stream as unknown);
  };

  const abortController = createStreamAbortController({
    signal,
    deadlineMs: options.deadlineMs,
    destroyStream,
    onTimeout: (): void => {
      markStopped(state, 'timeout');
    },
    onAbort: (): void => {
      // No-op: abort state handled by caller.
    },
  });

  try {
    await drainStream(stream, state, options, batch, signal);
  } catch (error) {
    handleScanError(error, options, signal);
  } finally {
    abortController.cleanup();
  }

  throwIfAborted(signal, options.deadlineMs);
}

export function createSearchStream(
  basePath: string,
  pattern: string,
  excludePatterns: string[],
  maxDepth: number | undefined,
  baseNameMatch = false,
  skipSymlinks = true,
  includeHidden = false
): AsyncIterable<string | Buffer> {
  return fg.stream(pattern, {
    cwd: basePath,
    absolute: true,
    onlyFiles: true,
    dot: includeHidden,
    ignore: excludePatterns,
    suppressErrors: true,
    followSymbolicLinks: !skipSymlinks,
    deep: maxDepth,
    baseNameMatch,
  });
}
