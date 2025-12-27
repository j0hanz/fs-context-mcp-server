import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Stats } from 'node:fs';

import type { MediaFileResult } from '../../config/types.js';
import { getMimeType, MAX_MEDIA_FILE_SIZE } from '../constants.js';
import { ErrorCode, McpError } from '../errors.js';
import { validateExistingPath } from '../path-validation.js';

function assertFile(stats: Stats, filePath: string): void {
  if (stats.isFile()) return;
  throw new McpError(ErrorCode.E_NOT_FILE, `Not a file: ${filePath}`, filePath);
}

function assertSizeWithinLimit(
  size: number,
  maxSize: number,
  filePath: string
): void {
  if (size <= maxSize) return;
  throw new McpError(
    ErrorCode.E_TOO_LARGE,
    `File too large: ${size} bytes (max: ${maxSize} bytes)`,
    filePath,
    { size, maxSize }
  );
}

export async function readMediaFile(
  filePath: string,
  { maxSize = MAX_MEDIA_FILE_SIZE }: { maxSize?: number } = {}
): Promise<MediaFileResult> {
  if (maxSize > MAX_MEDIA_FILE_SIZE) {
    throw new McpError(
      ErrorCode.E_INVALID_INPUT,
      `maxSize cannot exceed ${MAX_MEDIA_FILE_SIZE} bytes`,
      filePath,
      { maxSize, maxAllowed: MAX_MEDIA_FILE_SIZE }
    );
  }
  const validPath = await validateExistingPath(filePath);
  const stats = await fs.stat(validPath);

  assertFile(stats, filePath);
  assertSizeWithinLimit(stats.size, maxSize, filePath);

  const ext = path.extname(validPath).toLowerCase();
  const mimeType = getMimeType(ext);
  const buffer = await fs.readFile(validPath);

  return {
    path: validPath,
    mimeType,
    size: stats.size,
    data: buffer.toString('base64'),
  };
}
