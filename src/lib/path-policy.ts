import * as path from 'node:path';
import { platform } from 'node:os';

import {
  SENSITIVE_FILE_ALLOWLIST,
  SENSITIVE_FILE_DENYLIST,
} from './constants.js';
import { ErrorCode, McpError } from './errors.js';
import { toPosixPath } from './path-format.js';

interface CompiledPattern {
  raw: string;
  globs: readonly string[];
  matchesPath: boolean;
}

const IS_WINDOWS = platform() === 'win32';
const WINDOWS_ABSOLUTE_RE = /^[a-z]:\//iu;

function normalizePathForMatch(input: string): string {
  return toPosixPath(path.normalize(input));
}

function normalizeForMatch(input: string): string {
  const normalized = normalizePathForMatch(input);
  return IS_WINDOWS ? normalized.toLowerCase() : normalized;
}

function compilePatternGlobs(normalizedPattern: string): readonly string[] {
  const globs = new Set<string>([normalizedPattern]);
  const isWindowsAbsolute = WINDOWS_ABSOLUTE_RE.test(normalizedPattern);

  if (!normalizedPattern.startsWith('**/') && !isWindowsAbsolute) {
    const withoutRoot = normalizedPattern.replace(/^\/+/u, '');
    if (withoutRoot.length > 0) {
      globs.add(`**/${withoutRoot}`);
    }
  }

  return [...globs];
}

function compilePatterns(patterns: readonly string[]): CompiledPattern[] {
  const unique = new Set<string>();
  for (const pattern of patterns) {
    const trimmed = pattern.trim();
    if (trimmed.length > 0) {
      unique.add(trimmed);
    }
  }

  const compiled: CompiledPattern[] = [];
  for (const pattern of unique) {
    const normalized = normalizeForMatch(pattern);
    const matchesPath = normalized.includes('/');
    compiled.push({
      raw: normalized,
      globs: matchesPath ? compilePatternGlobs(normalized) : [normalized],
      matchesPath,
    });
  }
  return compiled;
}

const DENY_PATTERNS = compilePatterns(SENSITIVE_FILE_DENYLIST);
const ALLOW_PATTERNS = compilePatterns(SENSITIVE_FILE_ALLOWLIST);

function uniquePair(primary: string, secondary?: string): string[] {
  if (!secondary || secondary === primary) return [primary];
  return [primary, secondary];
}

function matchesAny(
  patterns: readonly CompiledPattern[],
  pathCandidates: readonly string[],
  nameCandidates: readonly string[]
): boolean {
  for (const pattern of patterns) {
    const candidates = pattern.matchesPath ? pathCandidates : nameCandidates;
    for (const candidate of candidates) {
      for (const glob of pattern.globs) {
        if (path.posix.matchesGlob(candidate, glob)) return true;
      }
    }
  }
  return false;
}

export function isSensitivePath(
  requestedPath: string,
  resolvedPath?: string
): boolean {
  if (DENY_PATTERNS.length === 0) return false;

  const normalizedRequested = normalizeForMatch(requestedPath);
  const normalizedResolved = resolvedPath
    ? normalizeForMatch(resolvedPath)
    : undefined;

  const pathCandidates = uniquePair(normalizedRequested, normalizedResolved);
  const nameCandidates = uniquePair(
    path.posix.basename(normalizedRequested),
    normalizedResolved ? path.posix.basename(normalizedResolved) : undefined
  );

  if (matchesAny(ALLOW_PATTERNS, pathCandidates, nameCandidates)) {
    return false;
  }

  return matchesAny(DENY_PATTERNS, pathCandidates, nameCandidates);
}

export function assertAllowedFileAccess(
  requestedPath: string,
  resolvedPath?: string
): void {
  if (!isSensitivePath(requestedPath, resolvedPath)) return;
  throw new McpError(
    ErrorCode.E_ACCESS_DENIED,
    `Access denied: sensitive file blocked by policy (${requestedPath}). ` +
      'Set FS_CONTEXT_ALLOW_SENSITIVE=1 or use FS_CONTEXT_ALLOWLIST to override.',
    requestedPath
  );
}
