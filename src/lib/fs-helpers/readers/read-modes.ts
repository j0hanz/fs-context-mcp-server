import type { Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';

import { ErrorCode, McpError } from '../../errors.js';
import { readFullContent, readHeadContent } from './read-file-content.js';
import {
  type NormalizedOptions,
  type ReadFileResult,
  resolveReadMode,
} from './read-options.js';

async function readHeadResult(
  handle: FileHandle,
  validPath: string,
  filePath: string,
  normalized: NormalizedOptions
): Promise<ReadFileResult> {
  const { head } = normalized;
  if (head === undefined) {
    throw new McpError(
      ErrorCode.E_INVALID_INPUT,
      'Missing head option',
      filePath
    );
  }
  const { content, truncated, linesRead, hasMoreLines } = await readHeadContent(
    handle,
    head,
    {
      encoding: normalized.encoding,
      maxSize: normalized.maxSize,
      signal: normalized.signal,
    }
  );
  return {
    path: validPath,
    content,
    truncated,
    totalLines: undefined,
    readMode: 'head',
    head,
    linesRead,
    hasMoreLines,
  };
}

async function readFullResult(
  handle: FileHandle,
  validPath: string,
  filePath: string,
  stats: Stats,
  normalized: NormalizedOptions
): Promise<ReadFileResult> {
  if (stats.size > normalized.maxSize) {
    throw new McpError(
      ErrorCode.E_TOO_LARGE,
      `File too large: ${stats.size} bytes (max: ${normalized.maxSize} bytes). Use head parameter to preview the first N lines.`,
      filePath,
      { size: stats.size, maxSize: normalized.maxSize }
    );
  }
  const { content, totalLines } = await readFullContent(
    handle,
    normalized.encoding,
    normalized.maxSize,
    filePath,
    normalized.signal
  );
  return {
    path: validPath,
    content,
    truncated: false,
    totalLines,
    readMode: 'full',
    linesRead: totalLines,
    hasMoreLines: false,
  };
}

export async function readByMode(
  handle: FileHandle,
  validPath: string,
  filePath: string,
  stats: Stats,
  normalized: NormalizedOptions
): Promise<ReadFileResult> {
  const mode = resolveReadMode(normalized);
  if (mode === 'head') {
    return await readHeadResult(handle, validPath, filePath, normalized);
  }
  return await readFullResult(handle, validPath, filePath, stats, normalized);
}
