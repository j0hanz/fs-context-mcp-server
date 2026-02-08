import { parentPort, workerData } from 'node:worker_threads';

import { isProbablyBinary } from '../fs-helpers.js';
import { startPerfMeasure } from '../observability.js';
import { buildMatcher, scanFileInWorker } from './search-content.js';
import type {
  Matcher,
  MatcherOptions,
  ScanError,
  ScanRequest,
  ScanResult,
  WorkerResponse,
} from './search-content.js';

interface CancelRequest {
  type: 'cancel';
  id: number;
}

interface ShutdownRequest {
  type: 'shutdown';
}

type WorkerRequest = ScanRequest | CancelRequest | ShutdownRequest;

const matcherCache = new Map<string, Matcher>();

function getMatcherCacheKey(pattern: string, options: MatcherOptions): string {
  const cs = options.caseSensitive ? '1' : '0';
  const ww = options.wholeWord ? '1' : '0';
  const lit = options.isLiteral ? '1' : '0';
  return `${pattern}|${cs}|${ww}|${lit}`;
}

function getCachedMatcher(pattern: string, options: MatcherOptions): Matcher {
  const key = getMatcherCacheKey(pattern, options);
  const cached = matcherCache.get(key);

  if (cached) {
    matcherCache.delete(key);
    matcherCache.set(key, cached);
    return cached;
  }

  const matcher = buildMatcher(pattern, options);
  matcherCache.set(key, matcher);

  if (matcherCache.size > 100) {
    const firstKey = matcherCache.keys().next().value;
    if (firstKey !== undefined) {
      matcherCache.delete(firstKey);
    }
  }

  return matcher;
}

const cancelledRequests = new Set<number>();
const activeRequests = new Set<number>();

function consumeCancelled(id: number): boolean {
  if (!cancelledRequests.has(id)) {
    return false;
  }
  cancelledRequests.delete(id);
  return true;
}

function buildScanResponse(
  id: number,
  result: ScanResult['result']
): ScanResult {
  return {
    type: 'result',
    id,
    result,
  };
}

function buildErrorResponse(id: number, error: unknown): ScanError {
  return {
    type: 'error',
    id,
    error: error instanceof Error ? error.message : String(error),
  };
}

async function handleScanRequest(request: ScanRequest): Promise<void> {
  const {
    id,
    resolvedPath,
    requestedPath,
    pattern,
    matcherOptions,
    scanOptions,
    maxMatches,
  } = request;

  if (consumeCancelled(id)) return;
  activeRequests.add(id);

  const endMeasure = startPerfMeasure('searchWorker.scan', {
    maxMatches,
  });
  let ok = false;

  try {
    const matcher = getCachedMatcher(pattern, matcherOptions);

    const isCancelled = (): boolean => cancelledRequests.has(id);

    const result = await scanFileInWorker(
      resolvedPath,
      requestedPath,
      matcher,
      scanOptions,
      maxMatches,
      isCancelled,
      isProbablyBinary
    );

    if (consumeCancelled(id)) return;
    parentPort?.postMessage(buildScanResponse(id, result));
    ok = true;
  } catch (err) {
    if (consumeCancelled(id)) return;
    parentPort?.postMessage(buildErrorResponse(id, err));
  } finally {
    activeRequests.delete(id);
    cancelledRequests.delete(id);
    endMeasure?.(ok);
  }
}

function handleMessage(message: WorkerRequest): void {
  switch (message.type) {
    case 'scan':
      void handleScanRequest(message);
      break;
    case 'cancel':
      if (activeRequests.has(message.id)) {
        cancelledRequests.add(message.id);
      }
      break;
    case 'shutdown':
      process.exit(0);
      break;
  }
}

if (parentPort) {
  parentPort.on('message', handleMessage);

  const data = workerData as { debug?: boolean; threadId?: number } | null;
  if (data?.debug) {
    console.error(
      `[SearchWorker] Started with threadId=${String(data.threadId)}`
    );
  }
}

export type { WorkerResponse, ScanRequest, ScanResult };
