import * as fs from 'node:fs/promises';

import fg from 'fast-glob';

import type { ContentMatch, SearchContentResult } from '../../config/types.js';
import { DEFAULT_MAX_RESULTS, MAX_SEARCHABLE_FILE_SIZE } from '../constants.js';
import { isProbablyBinary } from '../fs-helpers.js';
import {
  validateExistingPath,
  validateExistingPathDetailed,
} from '../path-validation.js';
import { scanFileForContent } from '../search-helpers.js';
import { buildSearchRegex } from './search-regex.js';

interface SearchContentState {
  matches: ContentMatch[];
  filesScanned: number;
  filesMatched: number;
  skippedTooLarge: number;
  skippedBinary: number;
  skippedInaccessible: number;
  linesSkippedDueToRegexTimeout: number;
  truncated: boolean;
  stoppedReason: SearchContentResult['summary']['stoppedReason'];
}

interface CandidateScanResult {
  matches: ContentMatch[];
  fileHadMatches: boolean;
  linesSkippedDueToRegexTimeout: number;
  skippedTooLarge: boolean;
  skippedBinary: boolean;
  scanned: boolean;
}

function initSearchContentState(): SearchContentState {
  return {
    matches: [],
    filesScanned: 0,
    filesMatched: 0,
    skippedTooLarge: 0,
    skippedBinary: 0,
    skippedInaccessible: 0,
    linesSkippedDueToRegexTimeout: 0,
    truncated: false,
    stoppedReason: undefined,
  };
}

type SearchStopReason = SearchContentResult['summary']['stoppedReason'];

function getSearchStopReason(
  deadlineMs: number | undefined,
  maxFilesScanned: number | undefined,
  maxResults: number,
  filesScanned: number,
  matchCount: number
): SearchStopReason | undefined {
  if (deadlineMs !== undefined && Date.now() > deadlineMs) return 'timeout';
  if (maxFilesScanned !== undefined && filesScanned >= maxFilesScanned) {
    return 'maxFiles';
  }
  if (matchCount >= maxResults) return 'maxResults';
  return undefined;
}

function applySearchStop(
  state: SearchContentState,
  reason: SearchStopReason
): void {
  state.truncated = true;
  state.stoppedReason = reason;
}

function getStopReasonIfAny(
  state: SearchContentState,
  options: {
    deadlineMs?: number;
    maxFilesScanned?: number;
    maxResults: number;
  }
): SearchStopReason | undefined {
  return getSearchStopReason(
    options.deadlineMs,
    options.maxFilesScanned,
    options.maxResults,
    state.filesScanned,
    state.matches.length
  );
}

function applyStopIfNeeded(
  state: SearchContentState,
  reason: SearchStopReason | undefined
): boolean {
  if (!reason) return false;
  applySearchStop(state, reason);
  return true;
}

async function resolveSearchPath(
  rawPath: string
): Promise<{ openPath: string; displayPath: string } | null> {
  try {
    const validatedPath = await validateExistingPathDetailed(rawPath);
    return {
      openPath: validatedPath.resolvedPath,
      displayPath: validatedPath.requestedPath,
    };
  } catch {
    return null;
  }
}

function mapMatchesToDisplayPath(
  matches: ContentMatch[],
  displayPath: string
): ContentMatch[] {
  return matches.map((match) => ({ ...match, file: displayPath }));
}

function buildSkipResult(
  scanned: boolean,
  skippedTooLarge: boolean,
  skippedBinary: boolean
): CandidateScanResult {
  return {
    matches: [],
    fileHadMatches: false,
    linesSkippedDueToRegexTimeout: 0,
    skippedTooLarge,
    skippedBinary,
    scanned,
  };
}

async function scanWithHandle(
  handle: fs.FileHandle,
  openPath: string,
  displayPath: string,
  regex: RegExp,
  options: {
    maxResults: number;
    currentMatchCount: number;
    maxFileSize: number;
    skipBinary: boolean;
    isLiteral: boolean;
    searchPattern: string;
    caseSensitive: boolean;
    contextLines: number;
    wholeWord: boolean;
    deadlineMs?: number;
  }
): Promise<CandidateScanResult> {
  const stats = await handle.stat();
  if (stats.size > options.maxFileSize) {
    return buildSkipResult(true, true, false);
  }

  if (options.skipBinary) {
    const binary = await isProbablyBinary(openPath, handle);
    if (binary) {
      return buildSkipResult(true, false, true);
    }
  }

  const scanResult: Awaited<ReturnType<typeof scanFileForContent>> =
    await scanFileForContent(openPath, regex, {
      maxResults: options.maxResults,
      contextLines: options.contextLines,
      deadlineMs: options.deadlineMs,
      currentMatchCount: options.currentMatchCount,
      isLiteral: options.isLiteral,
      searchString: options.isLiteral ? options.searchPattern : undefined,
      caseSensitive: options.caseSensitive,
      wholeWord: options.wholeWord,
      fileHandle: handle,
    });

  const mappedMatches = mapMatchesToDisplayPath(
    scanResult.matches,
    displayPath
  );

  return {
    matches: mappedMatches,
    fileHadMatches: scanResult.fileHadMatches,
    linesSkippedDueToRegexTimeout: scanResult.linesSkippedDueToRegexTimeout,
    skippedTooLarge: false,
    skippedBinary: false,
    scanned: true,
  };
}

async function scanCandidateFile(
  openPath: string,
  displayPath: string,
  regex: RegExp,
  options: {
    maxResults: number;
    currentMatchCount: number;
    maxFileSize: number;
    skipBinary: boolean;
    isLiteral: boolean;
    searchPattern: string;
    caseSensitive: boolean;
    contextLines: number;
    wholeWord: boolean;
    deadlineMs?: number;
  }
): Promise<CandidateScanResult> {
  const handle = await fs.open(openPath, 'r');

  try {
    return await scanWithHandle(handle, openPath, displayPath, regex, options);
  } finally {
    await handle.close().catch(() => {});
  }
}

function updateStateFromScan(
  state: SearchContentState,
  scanResult: CandidateScanResult
): void {
  if (scanResult.scanned) state.filesScanned++;
  if (scanResult.skippedTooLarge) {
    state.skippedTooLarge++;
    return;
  }
  if (scanResult.skippedBinary) {
    state.skippedBinary++;
    return;
  }

  state.matches.push(...scanResult.matches);
  state.linesSkippedDueToRegexTimeout +=
    scanResult.linesSkippedDueToRegexTimeout;
  if (scanResult.fileHadMatches) state.filesMatched++;
}

function createSearchStream(
  basePath: string,
  filePattern: string,
  excludePatterns: string[],
  includeHidden: boolean
): AsyncIterable<string | Buffer> {
  return fg.stream(filePattern, {
    cwd: basePath,
    absolute: true,
    onlyFiles: true,
    dot: includeHidden,
    ignore: excludePatterns,
    suppressErrors: true,
    followSymbolicLinks: false,
  });
}

async function scanSearchStream(
  stream: AsyncIterable<string | Buffer>,
  state: SearchContentState,
  options: {
    deadlineMs?: number;
    maxFilesScanned?: number;
    maxResults: number;
    maxFileSize: number;
    skipBinary: boolean;
    isLiteral: boolean;
    searchPattern: string;
    caseSensitive: boolean;
    contextLines: number;
    wholeWord: boolean;
  },
  regex: RegExp
): Promise<void> {
  for await (const entry of stream) {
    const rawPath = typeof entry === 'string' ? entry : String(entry);
    const resolved = await resolveSearchPath(rawPath);
    if (!resolved) {
      state.skippedInaccessible++;
      continue;
    }

    if (applyStopIfNeeded(state, getStopReasonIfAny(state, options))) break;

    try {
      const scanResult = await scanCandidateFile(
        resolved.openPath,
        resolved.displayPath,
        regex,
        {
          maxResults: options.maxResults,
          currentMatchCount: state.matches.length,
          maxFileSize: options.maxFileSize,
          skipBinary: options.skipBinary,
          isLiteral: options.isLiteral,
          searchPattern: options.searchPattern,
          caseSensitive: options.caseSensitive,
          contextLines: options.contextLines,
          wholeWord: options.wholeWord,
          deadlineMs: options.deadlineMs,
        }
      );

      updateStateFromScan(state, scanResult);
    } catch {
      state.skippedInaccessible++;
    }

    if (applyStopIfNeeded(state, getStopReasonIfAny(state, options))) break;
  }
}

export async function searchContent(
  basePath: string,
  searchPattern: string,
  options: {
    filePattern?: string;
    excludePatterns?: string[];
    caseSensitive?: boolean;
    maxResults?: number;
    maxFileSize?: number;
    maxFilesScanned?: number;
    timeoutMs?: number;
    skipBinary?: boolean;
    contextLines?: number;
    wholeWord?: boolean;
    isLiteral?: boolean;
    includeHidden?: boolean;
  } = {}
): Promise<SearchContentResult> {
  const {
    filePattern = '**/*',
    excludePatterns = [],
    caseSensitive = false,
    maxResults = DEFAULT_MAX_RESULTS,
    maxFileSize = MAX_SEARCHABLE_FILE_SIZE,
    maxFilesScanned,
    timeoutMs,
    skipBinary = true,
    contextLines = 0,
    wholeWord = false,
    isLiteral = false,
    includeHidden = false,
  } = options;

  const validPath = await validateExistingPath(basePath);
  const deadlineMs =
    timeoutMs !== undefined ? Date.now() + timeoutMs : undefined;
  const { regex } = buildSearchRegex(searchPattern, {
    isLiteral,
    wholeWord,
    caseSensitive,
    basePath,
  });

  const state = initSearchContentState();
  const stream = createSearchStream(
    validPath,
    filePattern,
    excludePatterns,
    includeHidden
  );

  try {
    await scanSearchStream(
      stream,
      state,
      {
        deadlineMs,
        maxFilesScanned,
        maxResults,
        maxFileSize,
        skipBinary,
        isLiteral,
        searchPattern,
        caseSensitive,
        contextLines,
        wholeWord,
      },
      regex
    );
  } finally {
    const { destroy } = stream as { destroy?: () => void };
    if (typeof destroy === 'function') destroy.call(stream);
  }

  return {
    basePath: validPath,
    pattern: searchPattern,
    filePattern,
    matches: state.matches,
    summary: {
      filesScanned: state.filesScanned,
      filesMatched: state.filesMatched,
      matches: state.matches.length,
      truncated: state.truncated,
      skippedTooLarge: state.skippedTooLarge,
      skippedBinary: state.skippedBinary,
      skippedInaccessible: state.skippedInaccessible,
      linesSkippedDueToRegexTimeout: state.linesSkippedDueToRegexTimeout,
      stoppedReason: state.stoppedReason,
    },
  };
}
