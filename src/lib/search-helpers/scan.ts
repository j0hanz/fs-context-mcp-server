import * as readline from 'node:readline';
import { createReadStream } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';

import type { ContentMatch } from '../../config/types.js';
import { MAX_LINE_CONTENT_LENGTH } from '../constants.js';
import { countLiteralMatches, countRegexMatches } from './regex.js';

interface PendingMatch {
  match: ContentMatch;
  afterNeeded: number;
}

interface ScanFileResult {
  matches: ContentMatch[];
  linesSkippedDueToRegexTimeout: number;
  fileHadMatches: boolean;
}

interface MatchCountOptions {
  isLiteral?: boolean;
  searchString?: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

interface ScanState {
  matches: ContentMatch[];
  linesSkippedDueToRegexTimeout: number;
  fileHadMatches: boolean;
  lineNumber: number;
  contextBuffer: string[];
  pendingMatches: PendingMatch[];
}

function initScanState(): ScanState {
  return {
    matches: [],
    linesSkippedDueToRegexTimeout: 0,
    fileHadMatches: false,
    lineNumber: 0,
    contextBuffer: [],
    pendingMatches: [],
  };
}

function shouldStopScan(
  deadlineMs: number | undefined,
  currentMatchCount: number,
  matches: ContentMatch[],
  maxResults: number
): boolean {
  if (deadlineMs !== undefined && Date.now() > deadlineMs) return true;
  return currentMatchCount + matches.length >= maxResults;
}

function trimAndClampLine(line: string): string {
  return line.trimEnd().substring(0, MAX_LINE_CONTENT_LENGTH);
}

function getMatchCount(
  line: string,
  regex: RegExp,
  options: MatchCountOptions
): number {
  if (options.isLiteral && options.searchString && !options.wholeWord) {
    return countLiteralMatches(
      line,
      options.searchString,
      options.caseSensitive ?? false
    );
  }
  return countRegexMatches(line, regex);
}

function updatePendingMatches(
  pendingMatches: PendingMatch[],
  trimmedLine: string
): void {
  for (const pending of pendingMatches) {
    if (pending.afterNeeded > 0) {
      pending.match.contextAfter ??= [];
      pending.match.contextAfter.push(trimmedLine);
      pending.afterNeeded--;
    }
  }
  while (pendingMatches.length > 0 && pendingMatches[0]?.afterNeeded === 0) {
    pendingMatches.shift();
  }
}

function buildMatch(
  file: string,
  line: number,
  content: string,
  matchCount: number,
  contextBuffer: string[]
): ContentMatch {
  const match: ContentMatch = { file, line, content, matchCount };
  if (contextBuffer.length > 0) {
    match.contextBefore = [...contextBuffer];
  }
  return match;
}

function queueContextAfter(
  pendingMatches: PendingMatch[],
  match: ContentMatch,
  contextLines: number
): void {
  if (contextLines <= 0) return;
  pendingMatches.push({ match, afterNeeded: contextLines });
}

function pushContextLine(
  contextBuffer: string[],
  trimmedLine: string,
  contextLines: number
): void {
  if (contextLines <= 0) return;
  contextBuffer.push(trimmedLine);
  if (contextBuffer.length > contextLines) contextBuffer.shift();
}

function applyMatch(
  state: ScanState,
  filePath: string,
  lineNumber: number,
  trimmedLine: string,
  matchCount: number,
  contextLines: number
): void {
  state.fileHadMatches = true;
  const newMatch = buildMatch(
    filePath,
    lineNumber,
    trimmedLine,
    matchCount,
    state.contextBuffer
  );
  state.matches.push(newMatch);
  queueContextAfter(state.pendingMatches, newMatch, contextLines);
}

function updateContext(
  state: ScanState,
  trimmedLine: string,
  contextLines: number
): void {
  pushContextLine(state.contextBuffer, trimmedLine, contextLines);
}

function recordTimeoutLine(
  state: ScanState,
  trimmedLine: string,
  contextLines: number
): void {
  state.linesSkippedDueToRegexTimeout++;
  pushContextLine(state.contextBuffer, trimmedLine, contextLines);
}

async function scanLines(
  rl: readline.Interface,
  filePath: string,
  regex: RegExp,
  options: {
    maxResults: number;
    contextLines: number;
    deadlineMs?: number;
    currentMatchCount: number;
    isLiteral?: boolean;
    searchString?: string;
    caseSensitive?: boolean;
    wholeWord?: boolean;
  },
  state: ScanState
): Promise<void> {
  for await (const line of rl) {
    const shouldStop = handleLine(line, filePath, regex, options, state);
    if (shouldStop) break;
  }
}

function handleLine(
  line: string,
  filePath: string,
  regex: RegExp,
  options: {
    maxResults: number;
    contextLines: number;
    deadlineMs?: number;
    currentMatchCount: number;
    isLiteral?: boolean;
    searchString?: string;
    caseSensitive?: boolean;
    wholeWord?: boolean;
  },
  state: ScanState
): boolean {
  state.lineNumber++;

  if (
    shouldStopScan(
      options.deadlineMs,
      options.currentMatchCount,
      state.matches,
      options.maxResults
    )
  ) {
    return true;
  }

  const trimmedLine = trimAndClampLine(line);
  updatePendingMatches(state.pendingMatches, trimmedLine);

  const matchCount = getMatchCount(line, regex, {
    isLiteral: options.isLiteral,
    searchString: options.searchString,
    caseSensitive: options.caseSensitive,
    wholeWord: options.wholeWord,
  });

  if (matchCount < 0) {
    recordTimeoutLine(state, trimmedLine, options.contextLines);
    return false;
  }

  if (matchCount > 0) {
    applyMatch(
      state,
      filePath,
      state.lineNumber,
      trimmedLine,
      matchCount,
      options.contextLines
    );
  }

  updateContext(state, trimmedLine, options.contextLines);
  return false;
}

function createLineReader(
  filePath: string,
  fileHandle?: FileHandle
): {
  rl: readline.Interface;
  fileStream: ReturnType<typeof createReadStream>;
} {
  const fileStream =
    fileHandle?.createReadStream({ encoding: 'utf-8', autoClose: false }) ??
    createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });
  return { rl, fileStream };
}

export async function scanFileForContent(
  filePath: string,
  regex: RegExp,
  options: {
    maxResults: number;
    contextLines: number;
    deadlineMs?: number;
    currentMatchCount: number;
    isLiteral?: boolean;
    searchString?: string;
    caseSensitive?: boolean;
    wholeWord?: boolean;
    fileHandle?: FileHandle;
  }
): Promise<ScanFileResult> {
  const state = initScanState();
  const { rl, fileStream } = createLineReader(filePath, options.fileHandle);

  try {
    await scanLines(rl, filePath, regex, options, state);
  } finally {
    rl.close();
    fileStream.destroy();
  }

  return {
    matches: state.matches,
    linesSkippedDueToRegexTimeout: state.linesSkippedDueToRegexTimeout,
    fileHadMatches: state.fileHadMatches,
  };
}
