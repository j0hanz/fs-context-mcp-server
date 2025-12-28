import * as fs from 'node:fs/promises';
import type { Stats } from 'node:fs';

import { ErrorCode, McpError } from '../errors.js';
import { assertNotAborted, createAbortError } from '../fs-helpers/abort.js';
import { normalizePath } from '../path-utils.js';
import {
  isPathWithinAllowedDirectories,
  normalizeForComparison,
  RESERVED_DEVICE_NAMES,
} from './allowed-directories.js';
import { toAccessDeniedWithHint, toMcpError } from './errors.js';

interface ValidatedPathDetails {
  requestedPath: string;
  resolvedPath: string;
  isSymlink: boolean;
}

function ensureNonEmptyPath(requestedPath: string): void {
  if (!requestedPath || requestedPath.trim().length === 0) {
    throw new McpError(
      ErrorCode.E_INVALID_INPUT,
      'Path cannot be empty or whitespace',
      requestedPath
    );
  }
}

function ensureNoNullBytes(requestedPath: string): void {
  if (requestedPath.includes('\0')) {
    throw new McpError(
      ErrorCode.E_INVALID_INPUT,
      'Path contains null bytes',
      requestedPath
    );
  }
}

function ensureNoReservedWindowsNames(requestedPath: string): void {
  if (process.platform !== 'win32') return;

  const segments = requestedPath.split(/[\\/]/);
  for (const segment of segments) {
    const reserved = getReservedDeviceName(segment);
    if (reserved) {
      throw new McpError(
        ErrorCode.E_INVALID_INPUT,
        `Windows reserved device name not allowed: ${reserved}`,
        requestedPath
      );
    }
  }
}

function ensureNoWindowsDriveRelativePath(requestedPath: string): void {
  if (process.platform !== 'win32') return;
  if (/^[a-zA-Z]:(?![\\/])/.test(requestedPath)) {
    throw new McpError(
      ErrorCode.E_INVALID_INPUT,
      'Windows drive-relative paths are not allowed. Use C:\\\\path or C:/path instead of C:path.',
      requestedPath
    );
  }
}

function getReservedDeviceName(segment: string): string | undefined {
  const trimmed = segment.replace(/[ .]+$/g, '');
  const withoutStream = trimmed.split(':')[0] ?? '';
  const baseName = withoutStream.split('.')[0]?.toUpperCase();
  if (!baseName) return undefined;
  return RESERVED_DEVICE_NAMES.has(baseName) ? baseName : undefined;
}

function ensureWithinAllowedDirectories(
  normalizedPath: string,
  requestedPath: string,
  details?: Record<string, unknown>
): void {
  if (isPathWithinAllowedDirectories(normalizedPath)) return;

  throw new McpError(
    ErrorCode.E_ACCESS_DENIED,
    `Access denied: Path '${requestedPath}' is outside allowed directories`,
    requestedPath,
    details
  );
}

function validateRequestedPath(requestedPath: string): string {
  ensureNonEmptyPath(requestedPath);
  ensureNoNullBytes(requestedPath);
  ensureNoReservedWindowsNames(requestedPath);
  ensureNoWindowsDriveRelativePath(requestedPath);
  return normalizePath(requestedPath);
}

async function resolveRealPath(
  requestedPath: string,
  normalizedRequested: string,
  signal?: AbortSignal
): Promise<string> {
  try {
    assertNotAborted(signal);
    return await withAbort(fs.realpath(normalizedRequested), signal);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    throw toMcpError(requestedPath, error);
  }
}

async function assertIsDirectory(
  resolvedPath: string,
  requestedPath: string,
  signal?: AbortSignal
): Promise<void> {
  let stats: Stats;
  try {
    assertNotAborted(signal);
    stats = await withAbort(fs.stat(resolvedPath), signal);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    throw toMcpError(requestedPath, error);
  }

  if (stats.isDirectory()) return;

  throw new McpError(
    ErrorCode.E_NOT_DIRECTORY,
    `Not a directory: ${requestedPath}`,
    requestedPath
  );
}

async function validateExistingPathDetailsInternal(
  requestedPath: string,
  signal?: AbortSignal
): Promise<ValidatedPathDetails> {
  const normalizedRequested = validateRequestedPath(requestedPath);

  assertNotAborted(signal);
  ensureWithinAllowedDirectories(normalizedRequested, requestedPath, {
    normalizedPath: normalizedRequested,
  });

  const realPath = await resolveRealPath(
    requestedPath,
    normalizedRequested,
    signal
  );
  const normalizedReal = normalizePath(realPath);

  if (!isPathWithinAllowedDirectories(normalizedReal)) {
    throw toAccessDeniedWithHint(requestedPath, realPath, normalizedReal);
  }

  return {
    requestedPath: normalizedRequested,
    resolvedPath: normalizedReal,
    isSymlink:
      normalizeForComparison(normalizedRequested) !==
      normalizeForComparison(normalizedReal),
  };
}

export async function validateExistingPathDetailed(
  requestedPath: string,
  signal?: AbortSignal
): Promise<ValidatedPathDetails> {
  return validateExistingPathDetailsInternal(requestedPath, signal);
}

export async function validateExistingPath(
  requestedPath: string,
  signal?: AbortSignal
): Promise<string> {
  const details = await validateExistingPathDetailsInternal(
    requestedPath,
    signal
  );
  return details.resolvedPath;
}

export async function validateExistingDirectory(
  requestedPath: string,
  signal?: AbortSignal
): Promise<string> {
  const details = await validateExistingPathDetailsInternal(
    requestedPath,
    signal
  );
  await assertIsDirectory(details.resolvedPath, requestedPath, signal);
  return details.resolvedPath;
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    throw getAbortError(signal);
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(getAbortError(signal));
    };

    signal.addEventListener('abort', onAbort, { once: true });

    promise
      .then((value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      })
      .catch((error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });
}

function getAbortError(signal: AbortSignal): Error {
  const { reason } = signal as { reason?: unknown };
  return reason instanceof Error ? reason : createAbortError();
}
