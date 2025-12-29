import fg from 'fast-glob';

import { safeDestroy } from '../fs-helpers.js';
import {
  drainStream,
  handleScanError,
  markStopped,
  throwIfAborted,
} from './search-files-stream-processor.js';
import type { SearchFilesState } from './search-files.js';

export interface ScanStreamOptions {
  deadlineMs?: number;
  maxFilesScanned?: number;
  maxResults: number;
}

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

  let stopReason: 'timeout' | 'abort' | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = (): void => {
    if (!timeoutId) return;
    clearTimeout(timeoutId);
    timeoutId = undefined;
  };

  const stop = (reason: 'timeout' | 'abort'): void => {
    if (stopReason !== null) return;
    stopReason = reason;
    if (reason === 'timeout') {
      markStopped(state, 'timeout');
    }
    destroyStream();
  };

  const onAbortSignal = (): void => {
    const reason =
      options.deadlineMs !== undefined && Date.now() >= options.deadlineMs
        ? 'timeout'
        : 'abort';
    stop(reason);
    clearTimer();
  };

  const onTimeoutSignal = (): void => {
    if (stopReason === 'abort') return;
    stop('timeout');
  };

  if (signal?.aborted) {
    onAbortSignal();
  } else if (signal) {
    signal.addEventListener('abort', onAbortSignal, { once: true });
  }

  if (options.deadlineMs !== undefined) {
    const delay = Math.max(0, options.deadlineMs - Date.now());
    timeoutId = setTimeout(onTimeoutSignal, delay);
  }

  try {
    await drainStream(stream, state, options, batch, signal);
  } catch (error) {
    handleScanError(error, options, signal);
  } finally {
    if (signal) signal.removeEventListener('abort', onAbortSignal);
    clearTimer();
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
