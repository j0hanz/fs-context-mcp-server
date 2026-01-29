import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Root } from '@modelcontextprotocol/sdk/types.js';

import { ErrorCode, isNodeError, McpError } from './errors.js';
import { assertNotAborted, withAbort } from './fs-helpers.js';

function expandHome(filepath: string): string {
  if (filepath.startsWith('~/') || filepath === '~') {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

export function normalizePath(p: string): string {
  const expanded = expandHome(p);
  const resolved = path.resolve(expanded);

  if (process.platform === 'win32' && /^[A-Z]:/.test(resolved)) {
    return resolved.charAt(0).toLowerCase() + resolved.slice(1);
  }

  return resolved;
}

function resolveWithinRoot(root: string, input: string): string | null {
  const resolved = path.resolve(root, input);
  const relative = path.relative(root, resolved);
  if (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  ) {
    return resolved;
  }
  return null;
}

function isPathWithinRoot(root: string, candidate: string): boolean {
  return resolveWithinRoot(root, candidate) !== null;
}

function rethrowIfAborted(error: unknown): void {
  if (error instanceof Error && error.name === 'AbortError') {
    throw error;
  }
}

const PATH_SEPARATOR = process.platform === 'win32' ? '\\' : '/';

function normalizeForComparison(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function isSamePath(left: string, right: string): boolean {
  return normalizeForComparison(left) === normalizeForComparison(right);
}

function stripTrailingSeparator(normalized: string): string {
  return normalized.endsWith(PATH_SEPARATOR)
    ? normalized.slice(0, -1)
    : normalized;
}

function normalizeAllowedDirectory(dir: string): string {
  const normalized = normalizePath(dir.trim());
  if (normalized.length === 0) return '';

  const { root } = path.parse(normalized);
  const isRootPath = isSamePath(root, normalized);
  if (isRootPath) return root;

  return stripTrailingSeparator(normalized);
}

let allowedDirectories: string[] = [];

function setAllowedDirectories(dirs: readonly string[]): void {
  const normalized = dirs
    .map(normalizeAllowedDirectory)
    .filter((dir) => dir.length > 0);
  allowedDirectories = [...new Set(normalized)];
}

export function getAllowedDirectories(): string[] {
  return [...allowedDirectories];
}

export function isPathWithinDirectories(
  normalizedPath: string,
  allowedDirs: readonly string[]
): boolean {
  const candidate = normalizeForComparison(normalizedPath);
  return allowedDirs.some((allowedDir) =>
    isPathWithinRoot(normalizeForComparison(allowedDir), candidate)
  );
}

async function expandAllowedDirectories(
  dirs: readonly string[],
  signal?: AbortSignal
): Promise<string[]> {
  const normalizedDirs = dirs
    .map(normalizeAllowedDirectory)
    .filter((dir): dir is string => Boolean(dir) && dir.length > 0);

  const realPaths = await Promise.all(
    normalizedDirs.map((dir) => resolveRealPath(dir, signal))
  );

  const expanded: string[] = [];
  for (let i = 0; i < normalizedDirs.length; i++) {
    const normalized = normalizedDirs[i];
    if (!normalized) continue;
    expanded.push(normalized);

    const normalizedReal = realPaths[i];
    if (normalizedReal && !isSamePath(normalizedReal, normalized)) {
      expanded.push(normalizedReal);
    }
  }

  return [...new Set(expanded)];
}

async function resolveRealPath(
  normalized: string,
  signal?: AbortSignal
): Promise<string | null> {
  try {
    assertNotAborted(signal);
    const realPath = await withAbort(fs.realpath(normalized), signal);
    return normalizeAllowedDirectory(realPath);
  } catch {
    return null;
  }
}

export async function setAllowedDirectoriesResolved(
  dirs: readonly string[],
  signal?: AbortSignal
): Promise<void> {
  const expanded = await expandAllowedDirectories(dirs, signal);
  setAllowedDirectories(expanded);
}

export const RESERVED_DEVICE_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

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

function trimTrailingDotsAndSpaces(value: string): string {
  let end = value.length;
  while (end > 0) {
    const char = value[end - 1];
    if (char === ' ' || char === '.') {
      end -= 1;
      continue;
    }
    break;
  }
  return value.slice(0, end);
}

function getReservedDeviceName(segment: string): string | undefined {
  const trimmed = trimTrailingDotsAndSpaces(segment);
  const withoutStream = trimmed.split(':')[0] ?? '';
  const baseName = withoutStream.split('.')[0]?.toUpperCase();
  if (!baseName) return undefined;
  return RESERVED_DEVICE_NAMES.has(baseName) ? baseName : undefined;
}

export function getReservedDeviceNameForPath(
  requestedPath: string
): string | undefined {
  if (process.platform !== 'win32') return undefined;
  const segments = requestedPath.split(/[\\/]/);
  for (const segment of segments) {
    const reserved = getReservedDeviceName(segment);
    if (reserved) return reserved;
  }
  return undefined;
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

export function isWindowsDriveRelativePath(requestedPath: string): boolean {
  if (process.platform !== 'win32') return false;
  const driveLetter = requestedPath.charCodeAt(0);
  const isAsciiLetter =
    (driveLetter >= 65 && driveLetter <= 90) ||
    (driveLetter >= 97 && driveLetter <= 122);
  if (!isAsciiLetter || requestedPath[1] !== ':') return false;
  const next = requestedPath[2];
  return next !== '\\' && next !== '/';
}

function ensureNoWindowsDriveRelativePath(requestedPath: string): void {
  if (!isWindowsDriveRelativePath(requestedPath)) return;
  throw new McpError(
    ErrorCode.E_INVALID_INPUT,
    'Windows drive-relative paths are not allowed. Use C:\\path or C:/path instead of C:path.',
    requestedPath
  );
}

function resolveRequestedPath(requestedPath: string): string {
  const expanded = expandHome(requestedPath);
  if (!path.isAbsolute(expanded)) {
    const allowedDirs = getAllowedDirectories();
    if (allowedDirs.length > 1) {
      throw new McpError(
        ErrorCode.E_INVALID_INPUT,
        'Relative paths are ambiguous when multiple roots are configured. Provide an absolute path or specify the full root path.',
        requestedPath
      );
    }
    const baseDir = allowedDirs[0];
    if (baseDir) {
      return normalizePath(path.resolve(baseDir, expanded));
    }
  }
  return normalizePath(expanded);
}

function validateRequestedPath(requestedPath: string): string {
  ensureNonEmptyPath(requestedPath);
  ensureNoNullBytes(requestedPath);
  ensureNoReservedWindowsNames(requestedPath);
  ensureNoWindowsDriveRelativePath(requestedPath);
  return resolveRequestedPath(requestedPath);
}

const NODE_ERROR_MAP: Readonly<
  Record<
    string,
    { code: ErrorCode; message: (requestedPath: string) => string }
  >
> = {
  ENOENT: {
    code: ErrorCode.E_NOT_FOUND,
    message: (requestedPath) => `Path does not exist: ${requestedPath}`,
  },
  EACCES: {
    code: ErrorCode.E_PERMISSION_DENIED,
    message: (requestedPath) =>
      `Permission denied accessing path: ${requestedPath}`,
  },
  EPERM: {
    code: ErrorCode.E_PERMISSION_DENIED,
    message: (requestedPath) =>
      `Permission denied accessing path: ${requestedPath}`,
  },
  ELOOP: {
    code: ErrorCode.E_SYMLINK_NOT_ALLOWED,
    message: (requestedPath) =>
      `Too many symbolic links in path (possible circular reference): ${requestedPath}`,
  },
  ENAMETOOLONG: {
    code: ErrorCode.E_INVALID_INPUT,
    message: (requestedPath) => `Path name too long: ${requestedPath}`,
  },
} as const;

function buildAllowedDirectoriesHint(): string {
  const dirs = getAllowedDirectories();
  return dirs.length > 0
    ? `Allowed: ${dirs.join(', ')}`
    : 'No allowed directories configured.';
}

function toMcpError(requestedPath: string, error: unknown): McpError {
  const code = isNodeError(error) ? error.code : undefined;
  const mapping = code ? NODE_ERROR_MAP[code] : undefined;
  if (mapping) {
    return new McpError(
      mapping.code,
      mapping.message(requestedPath),
      requestedPath,
      { originalCode: code },
      error
    );
  }
  let message = '';
  if (error instanceof Error) {
    const { message: errorMessage } = error;
    message = errorMessage;
  } else if (typeof error === 'string') {
    message = error;
  }
  return new McpError(
    ErrorCode.E_NOT_FOUND,
    `Path is not accessible: ${requestedPath}`,
    requestedPath,
    { originalCode: code, originalMessage: message },
    error
  );
}

export function toAccessDeniedWithHint(
  requestedPath: string,
  resolvedPath: string,
  normalizedResolved: string
): McpError {
  const suggestion = buildAllowedDirectoriesHint();
  return new McpError(
    ErrorCode.E_ACCESS_DENIED,
    `Access denied: Path '${requestedPath}' is outside allowed directories.\n${suggestion}`,
    requestedPath,
    { resolvedPath, normalizedResolvedPath: normalizedResolved }
  );
}

interface ValidatedPathDetails {
  requestedPath: string;
  resolvedPath: string;
  isSymlink: boolean;
}

function ensureWithinAllowedDirectories(options: {
  normalizedPath: string;
  requestedPath: string;
  allowedDirs: readonly string[];
  details?: Record<string, unknown>;
}): void {
  const { normalizedPath, requestedPath, allowedDirs, details } = options;
  if (allowedDirs.length === 0) {
    throw new McpError(
      ErrorCode.E_ACCESS_DENIED,
      'Access denied: No allowed directories configured. Use --allow-cwd or configure roots via the MCP Roots protocol.',
      requestedPath,
      details
    );
  }
  if (isPathWithinDirectories(normalizedPath, allowedDirs)) return;

  throw new McpError(
    ErrorCode.E_ACCESS_DENIED,
    `Access denied: Path '${requestedPath}' is outside allowed directories`,
    requestedPath,
    details
  );
}

async function resolveRealPathOrThrow(options: {
  requestedPath: string;
  normalizedRequested: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { requestedPath, normalizedRequested, signal } = options;
  try {
    assertNotAborted(signal);
    return await withAbort(fs.realpath(normalizedRequested), signal);
  } catch (error) {
    rethrowIfAborted(error);
    throw toMcpError(requestedPath, error);
  }
}

async function validateExistingPathDetailsInternal(
  requestedPath: string,
  signal?: AbortSignal
): Promise<ValidatedPathDetails> {
  const normalizedRequested = validateRequestedPath(requestedPath);
  const allowedDirs = getAllowedDirectories();
  ensureWithinAllowedDirectories({
    normalizedPath: normalizedRequested,
    requestedPath,
    allowedDirs,
    details: { normalizedPath: normalizedRequested },
  });

  const realPath = await resolveRealPathOrThrow({
    requestedPath,
    normalizedRequested,
    ...(signal ? { signal } : {}),
  });
  const normalizedReal = normalizePath(realPath);

  if (!isPathWithinDirectories(normalizedReal, allowedDirs)) {
    throw toAccessDeniedWithHint(requestedPath, realPath, normalizedReal);
  }

  return {
    requestedPath: normalizedRequested,
    resolvedPath: normalizedReal,
    isSymlink: !isSamePath(normalizedRequested, normalizedReal),
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
  assertNotAborted(signal);
  const stats = await withAbort(fs.stat(details.resolvedPath), signal);
  if (!stats.isDirectory()) {
    throw new McpError(
      ErrorCode.E_NOT_DIRECTORY,
      `Not a directory: ${requestedPath}`,
      requestedPath
    );
  }
  return details.resolvedPath;
}

function isFileRoot(root: Root): boolean {
  return root.uri.startsWith('file://');
}

async function maybeAddRealPath(
  normalizedPath: string,
  validDirs: string[],
  signal?: AbortSignal
): Promise<void> {
  try {
    assertNotAborted(signal);
    const realPath = await withAbort(fs.realpath(normalizedPath), signal);
    const normalizedReal = normalizePath(realPath);
    if (!isSamePath(normalizedReal, normalizedPath)) {
      validDirs.push(normalizedReal);
    }
  } catch (error) {
    rethrowIfAborted(error);
  }
}

async function resolveRootDirectory(
  root: Root,
  signal?: AbortSignal
): Promise<string | null> {
  try {
    const dirPath = fileURLToPath(root.uri);
    const normalizedPath = normalizePath(dirPath);
    assertNotAborted(signal);
    const stats = await withAbort(fs.stat(normalizedPath), signal);
    if (!stats.isDirectory()) return null;
    return normalizedPath;
  } catch (error) {
    rethrowIfAborted(error);
    return null;
  }
}

export async function getValidRootDirectories(
  roots: Root[],
  signal?: AbortSignal
): Promise<string[]> {
  const validDirs: string[] = [];

  for (const root of roots) {
    if (!isFileRoot(root)) continue;

    const normalizedPath = await resolveRootDirectory(root, signal);
    if (!normalizedPath) continue;

    validDirs.push(normalizedPath);
    await maybeAddRealPath(normalizedPath, validDirs, signal);
  }

  return validDirs;
}
