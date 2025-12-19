import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Root } from '@modelcontextprotocol/sdk/types.js';

import { ErrorCode, McpError } from './errors.js';
import { normalizePath } from './path-utils.js';

interface ValidatedPathDetails {
  requestedPath: string;
  resolvedPath: string;
  isSymlink: boolean;
}

let allowedDirectories: string[] = [];

function normalizeAllowedDirectory(dir: string): string {
  const normalized = normalizePath(dir);
  if (normalized.length === 0) return '';
  const { root } = path.parse(normalized);
  const isRoot =
    normalizeForComparison(root) === normalizeForComparison(normalized);
  if (isRoot) {
    return root;
  }
  return normalized.endsWith(PATH_SEPARATOR)
    ? normalized.slice(0, -1)
    : normalized;
}

export function setAllowedDirectories(dirs: string[]): void {
  const normalized = dirs
    .map(normalizeAllowedDirectory)
    .filter((d) => d.length > 0);
  allowedDirectories = [...new Set(normalized)];
}

export function getAllowedDirectories(): string[] {
  return [...allowedDirectories];
}

const PATH_SEPARATOR = process.platform === 'win32' ? '\\' : '/';

function normalizeForComparison(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

function isPathWithinAllowedDirectories(normalizedPath: string): boolean {
  const candidate = normalizeForComparison(normalizedPath);
  return allowedDirectories.some((allowedDir) => {
    const allowed = normalizeForComparison(allowedDir);
    const root = normalizeForComparison(path.parse(allowedDir).root);
    if (allowed === root) {
      return candidate.startsWith(allowed);
    }
    return (
      candidate === allowed || candidate.startsWith(allowed + PATH_SEPARATOR)
    );
  });
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

function ensureNoReservedWindowsNames(requestedPath: string): void {
  if (process.platform !== 'win32') return;
  const segments = requestedPath.split(/[\\/]/);
  for (const segment of segments) {
    const baseName = segment.split('.')[0]?.toUpperCase();
    if (baseName && RESERVED_DEVICE_NAMES.has(baseName)) {
      throw new McpError(
        ErrorCode.E_INVALID_INPUT,
        `Windows reserved device name not allowed: ${baseName}`,
        requestedPath
      );
    }
  }
}

function ensureWithinAllowedDirectories(
  normalizedPath: string,
  requestedPath: string,
  details?: Record<string, unknown>
): void {
  if (!isPathWithinAllowedDirectories(normalizedPath)) {
    throw new McpError(
      ErrorCode.E_ACCESS_DENIED,
      `Access denied: Path '${requestedPath}' is outside allowed directories`,
      requestedPath,
      details
    );
  }
}

function buildAllowedDirectoriesHint(): string {
  const allowedDirs = getAllowedDirectories();
  return allowedDirs.length > 0
    ? `Allowed directories:\n${allowedDirs.map((d) => `  - ${d}`).join('\n')}`
    : 'No allowed directories configured. Use CLI arguments or MCP roots protocol.';
}

function toMcpError(requestedPath: string, error: unknown): McpError {
  const nodeError = error as NodeJS.ErrnoException;
  if (nodeError.code === 'ENOENT') {
    return new McpError(
      ErrorCode.E_NOT_FOUND,
      `Path does not exist: ${requestedPath}`,
      requestedPath,
      { originalCode: nodeError.code },
      error
    );
  }
  if (nodeError.code === 'EACCES' || nodeError.code === 'EPERM') {
    return new McpError(
      ErrorCode.E_PERMISSION_DENIED,
      `Permission denied accessing path: ${requestedPath}`,
      requestedPath,
      { originalCode: nodeError.code },
      error
    );
  }
  if (nodeError.code === 'ELOOP') {
    return new McpError(
      ErrorCode.E_SYMLINK_NOT_ALLOWED,
      `Too many symbolic links in path (possible circular reference): ${requestedPath}`,
      requestedPath,
      { originalCode: nodeError.code },
      error
    );
  }
  if (nodeError.code === 'ENAMETOOLONG') {
    return new McpError(
      ErrorCode.E_INVALID_INPUT,
      `Path name too long: ${requestedPath}`,
      requestedPath,
      { originalCode: nodeError.code },
      error
    );
  }
  return new McpError(
    ErrorCode.E_NOT_FOUND,
    `Path is not accessible: ${requestedPath}`,
    requestedPath,
    { originalCode: nodeError.code, originalMessage: nodeError.message },
    error
  );
}

function toAccessDeniedWithHint(
  requestedPath: string,
  resolvedPath: string,
  normalizedResolved: string
): McpError {
  const suggestion = buildAllowedDirectoriesHint();
  return new McpError(
    ErrorCode.E_ACCESS_DENIED,
    `Access denied: Path '${requestedPath}' is outside allowed directories.\n\n${suggestion}`,
    requestedPath,
    { resolvedPath, normalizedResolvedPath: normalizedResolved }
  );
}

async function validateExistingPathDetailsInternal(
  requestedPath: string
): Promise<ValidatedPathDetails> {
  ensureNonEmptyPath(requestedPath);
  ensureNoNullBytes(requestedPath);
  ensureNoReservedWindowsNames(requestedPath);

  const normalizedRequested = normalizePath(requestedPath);

  ensureWithinAllowedDirectories(normalizedRequested, requestedPath, {
    normalizedPath: normalizedRequested,
  });

  let realPath: string;
  try {
    realPath = await fs.realpath(normalizedRequested);
  } catch (error) {
    throw toMcpError(requestedPath, error);
  }
  const normalizedReal = normalizePath(realPath);

  if (!isPathWithinAllowedDirectories(normalizedReal)) {
    throw toAccessDeniedWithHint(requestedPath, realPath, normalizedReal);
  }

  const isSymlink = normalizedRequested !== normalizedReal;

  return {
    requestedPath: normalizedRequested,
    resolvedPath: normalizedReal,
    isSymlink,
  };
}

export async function validateExistingPathDetailed(
  requestedPath: string
): Promise<ValidatedPathDetails> {
  return validateExistingPathDetailsInternal(requestedPath);
}

export async function validateExistingPath(
  requestedPath: string
): Promise<string> {
  const details = await validateExistingPathDetailsInternal(requestedPath);
  return details.resolvedPath;
}

export async function getValidRootDirectories(
  roots: Root[]
): Promise<string[]> {
  const validDirs: string[] = [];

  for (const root of roots) {
    if (!root.uri.startsWith('file://')) {
      continue;
    }

    try {
      const dirPath = fileURLToPath(root.uri);
      const normalizedPath = normalizePath(dirPath);

      const stats = await fs.stat(normalizedPath);
      if (stats.isDirectory()) {
        validDirs.push(normalizedPath);
        try {
          const realPath = await fs.realpath(normalizedPath);
          const normalizedReal = normalizePath(realPath);
          if (
            normalizeForComparison(normalizedReal) !==
            normalizeForComparison(normalizedPath)
          ) {
            validDirs.push(normalizedReal);
          }
        } catch {
          // If realpath fails, use the normalized path only
        }
      } else {
        console.error(`Skipping root (not a directory): ${normalizedPath}`);
      }
    } catch {
      continue;
    }
  }

  return validDirs;
}

export async function expandAllowedDirectories(
  dirs: string[]
): Promise<string[]> {
  const expanded: string[] = [];

  for (const dir of dirs) {
    const normalized = normalizeAllowedDirectory(dir);
    if (!normalized) continue;
    expanded.push(normalized);
    try {
      const realPath = await fs.realpath(normalized);
      const normalizedReal = normalizeAllowedDirectory(realPath);
      if (
        normalizedReal &&
        normalizeForComparison(normalizedReal) !==
          normalizeForComparison(normalized)
      ) {
        expanded.push(normalizedReal);
      }
    } catch {
      // Keep normalized path if realpath fails
    }
  }

  return [...new Set(expanded)];
}

export async function setAllowedDirectoriesResolved(
  dirs: string[]
): Promise<void> {
  const expanded = await expandAllowedDirectories(dirs);
  setAllowedDirectories(expanded);
}
