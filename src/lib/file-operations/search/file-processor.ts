import * as fsPromises from 'node:fs/promises';
import type { ReadStream } from 'node:fs';

import type { ContentMatch } from '../../../config/types.js';
import {
  MAX_LINE_CONTENT_LENGTH,
  MAX_SEARCH_LINE_LENGTH,
} from '../../constants.js';
import { isProbablyBinary } from '../../fs-helpers.js';
import { validateExistingPathDetailed } from '../../path-validation.js';
import { ContextManager } from './context-manager.js';
import type { Matcher } from './match-strategy.js';
import type { ScanResult, SearchOptions } from './types.js';

function createEmptyResult(overrides: Partial<ScanResult>): ScanResult {
  return {
    matches: [],
    linesSkippedDueToRegexTimeout: 0,
    fileHadMatches: false,
    skippedTooLarge: false,
    skippedBinary: false,
    scanned: false,
    ...overrides,
  };
}

async function resolvePath(
  rawPath: string
): Promise<{ openPath: string; displayPath: string } | null> {
  try {
    const validated = await validateExistingPathDetailed(rawPath);
    return {
      openPath: validated.resolvedPath,
      displayPath: validated.requestedPath,
    };
  } catch {
    return null;
  }
}

function createReadStream(handle: fsPromises.FileHandle): ReadStream {
  return handle.createReadStream({
    encoding: 'utf-8',
    autoClose: false,
  });
}

function attachAbortHandler(
  stream: ReadStream,
  signal?: AbortSignal
): () => void {
  if (!signal) return () => {};

  const onAbort = (): void => {
    stream.destroy();
  };

  if (signal.aborted) {
    onAbort();
  } else {
    signal.addEventListener('abort', onAbort, { once: true });
  }

  return (): void => {
    signal.removeEventListener('abort', onAbort);
  };
}

async function* iterateLines(
  stream: ReadStream,
  maxLineLength: number,
  signal?: AbortSignal
): AsyncGenerator<string> {
  let buffer = '';
  let overflow = false;
  const detachAbort = attachAbortHandler(stream, signal);
  const iterableStream = stream as AsyncIterable<string | Buffer>;

  try {
    for await (const chunk of iterableStream) {
      if (signal?.aborted) break;
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      let cursor = 0;

      while (cursor < text.length) {
        const newlineIndex = text.indexOf('\n', cursor);
        const segmentEnd = newlineIndex === -1 ? text.length : newlineIndex;
        const segment = text.slice(cursor, segmentEnd);

        if (!overflow) {
          if (buffer.length + segment.length > maxLineLength) {
            const remaining = Math.max(0, maxLineLength - buffer.length);
            if (remaining > 0) {
              buffer += segment.slice(0, remaining);
            }
            overflow = true;
          } else {
            buffer += segment;
          }
        }

        if (newlineIndex !== -1) {
          yield buffer.replace(/\r$/, '');
          buffer = '';
          overflow = false;
          cursor = newlineIndex + 1;
        } else {
          cursor = segmentEnd;
        }
      }
    }

    if (!signal?.aborted && buffer.length > 0) {
      yield buffer.replace(/\r$/, '');
    }
  } finally {
    detachAbort();
  }
}

function trimLine(line: string): string {
  return line.trimEnd().substring(0, MAX_LINE_CONTENT_LENGTH);
}

function createScanResult(
  matches: ContentMatch[],
  linesSkipped: number
): ScanResult {
  return {
    matches,
    linesSkippedDueToRegexTimeout: linesSkipped,
    fileHadMatches: matches.length > 0,
    skippedTooLarge: false,
    skippedBinary: false,
    scanned: true,
  };
}

function shouldStop(
  currentFileMatches: number,
  options: SearchOptions
): boolean {
  if (options.deadlineMs && Date.now() > options.deadlineMs) {
    return true;
  }
  if (options.currentMatchCount + currentFileMatches >= options.maxResults) {
    return true;
  }
  return false;
}

async function scanLines(
  stream: ReadStream,
  displayPath: string,
  matcher: Matcher,
  options: SearchOptions,
  contextManager: ContextManager
): Promise<{ matches: ContentMatch[]; linesSkipped: number }> {
  const matches: ContentMatch[] = [];
  let linesSkipped = 0;
  let lineNumber = 0;

  for await (const line of iterateLines(
    stream,
    MAX_SEARCH_LINE_LENGTH,
    options.signal
  )) {
    if (options.signal?.aborted) break;
    lineNumber++;
    if (shouldStop(matches.length, options)) break;

    const trimmed = trimLine(line);
    contextManager.pushLine(trimmed);

    const matchCount = matcher(line);
    if (matchCount < 0) {
      linesSkipped++;
      continue;
    }
    if (matchCount === 0) {
      continue;
    }

    matches.push(
      contextManager.createMatch(displayPath, lineNumber, trimmed, matchCount)
    );
  }

  return { matches, linesSkipped };
}

async function scanContent(
  handle: fsPromises.FileHandle,
  displayPath: string,
  matcher: Matcher,
  options: SearchOptions
): Promise<ScanResult> {
  const contextManager = new ContextManager(options.contextLines);
  const stream = createReadStream(handle);

  try {
    const { matches, linesSkipped } = await scanLines(
      stream,
      displayPath,
      matcher,
      options,
      contextManager
    );
    return createScanResult(matches, linesSkipped);
  } finally {
    stream.destroy();
  }
}

async function scanWithHandle(
  handle: fsPromises.FileHandle,
  openPath: string,
  displayPath: string,
  matcher: Matcher,
  options: SearchOptions
): Promise<ScanResult> {
  const stats = await handle.stat();
  if (stats.size > options.maxFileSize) {
    return createEmptyResult({ scanned: true, skippedTooLarge: true });
  }

  if (options.skipBinary && (await isProbablyBinary(openPath, handle))) {
    return createEmptyResult({ scanned: true, skippedBinary: true });
  }

  return await scanContent(handle, displayPath, matcher, options);
}

export async function processFile(
  rawPath: string,
  matcher: Matcher,
  options: SearchOptions
): Promise<ScanResult> {
  if (options.signal?.aborted) {
    return createEmptyResult({ scanned: true });
  }
  const resolved = await resolvePath(rawPath);
  if (!resolved) {
    return createEmptyResult({ scanned: false }); // Inaccessible
  }

  const handle = await fsPromises.open(resolved.openPath, 'r');
  try {
    return await scanWithHandle(
      handle,
      resolved.openPath,
      resolved.displayPath,
      matcher,
      options
    );
  } finally {
    await handle.close().catch(() => {});
  }
}
