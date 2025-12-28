import type { SearchOptions as EngineSearchOptions } from './engine.js';
import type {
  ScanResult,
  SearchOptions as SearchFileOptions,
  SearchState,
} from './types.js';

export interface SearchLimits {
  maxResults: number;
  maxFilesScanned: number;
}

export type BaseFileOptions = Omit<
  SearchFileOptions,
  'currentMatchCount' | 'getCurrentMatchCount' | 'signal'
>;

export function buildSearchLimits(options: EngineSearchOptions): SearchLimits {
  return {
    maxResults: options.maxResults,
    maxFilesScanned: options.maxFilesScanned,
  };
}

export function buildBaseOptions(
  options: EngineSearchOptions,
  deadlineMs: number | undefined,
  searchPattern: string
): BaseFileOptions {
  return {
    maxResults: options.maxResults,
    contextLines: options.contextLines,
    deadlineMs,
    isLiteral: options.isLiteral,
    wholeWord: options.wholeWord,
    caseSensitive: options.caseSensitive,
    maxFileSize: options.maxFileSize,
    skipBinary: options.skipBinary,
    searchPattern,
  };
}

export function markMaxResults(state: SearchState): void {
  if (state.truncated) return;
  state.truncated = true;
  state.stoppedReason = 'maxResults';
}

export function markMaxFiles(state: SearchState): void {
  if (state.truncated) return;
  state.truncated = true;
  state.stoppedReason = 'maxFiles';
}

function stopDueToDeadline(
  state: SearchState,
  deadlineMs: number | undefined
): boolean {
  if (!deadlineMs) return false;
  if (Date.now() <= deadlineMs) return false;
  state.truncated = true;
  state.stoppedReason = 'timeout';
  return true;
}

function stopDueToMaxFiles(state: SearchState, limits: SearchLimits): boolean {
  if (state.filesScanned < limits.maxFilesScanned) return false;
  markMaxFiles(state);
  return true;
}

function stopDueToMaxResults(
  state: SearchState,
  limits: SearchLimits
): boolean {
  if (state.matches.length < limits.maxResults) return false;
  markMaxResults(state);
  return true;
}

export function shouldStop(
  state: SearchState,
  limits: SearchLimits,
  deadlineMs?: number
): boolean {
  if (stopDueToDeadline(state, deadlineMs)) return true;
  if (stopDueToMaxFiles(state, limits)) return true;
  if (stopDueToMaxResults(state, limits)) return true;
  return false;
}

export function shouldAbortOrStop(
  signal: AbortSignal | undefined,
  state: SearchState,
  limits: SearchLimits,
  deadlineMs?: number
): boolean {
  if (signal?.aborted) return true;
  return shouldStop(state, limits, deadlineMs);
}

function recordSkippedFlags(state: SearchState, result: ScanResult): void {
  if (result.skippedTooLarge) state.skippedTooLarge++;
  if (result.skippedBinary) state.skippedBinary++;
}

function appendMatchesWithinLimit(
  state: SearchState,
  matches: ScanResult['matches'],
  maxResults: number
): void {
  const remaining = maxResults - state.matches.length;
  if (remaining <= 0) {
    markMaxResults(state);
    return;
  }
  if (matches.length > remaining) {
    state.matches.push(...matches.slice(0, remaining));
    markMaxResults(state);
    return;
  }
  state.matches.push(...matches);
}

function updateMatchCounts(
  state: SearchState,
  matches: ScanResult['matches'],
  maxResults: number
): void {
  if (matches.length === 0) return;
  state.filesMatched++;
  appendMatchesWithinLimit(state, matches, maxResults);
}

export function updateState(
  state: SearchState,
  result: ScanResult,
  maxResults: number
): void {
  state.filesScanned++;
  if (!result.scanned) {
    state.skippedInaccessible++;
    return;
  }

  recordSkippedFlags(state, result);
  updateMatchCounts(state, result.matches, maxResults);
  state.linesSkippedDueToRegexTimeout += result.linesSkippedDueToRegexTimeout;

  if (result.hitMaxResults) {
    markMaxResults(state);
  }
}

export function finalizeTimeoutState(
  state: SearchState,
  deadlineMs: number | undefined
): void {
  if (!deadlineMs) return;
  if (Date.now() <= deadlineMs) return;
  if (state.truncated) return;
  state.truncated = true;
  state.stoppedReason = 'timeout';
}

export function throwIfAborted(
  signal: AbortSignal | undefined,
  deadlineMs: number | undefined
): void {
  if (!signal?.aborted) return;
  if (deadlineMs && Date.now() >= deadlineMs) return;
  throw new Error('Search aborted');
}
