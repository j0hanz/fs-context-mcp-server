import * as path from 'node:path';
import { platform } from 'node:os';

import {
  SENSITIVE_FILE_ALLOWLIST,
  SENSITIVE_FILE_DENYLIST,
} from './constants.js';
import { ErrorCode, McpError } from './errors.js';

interface CompiledPattern {
  raw: string;
  regex: RegExp;
  matchesPath: boolean;
}

function escapeRegex(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePathForMatch(input: string): string {
  return path.normalize(input).replace(/\\/gu, '/');
}

function compilePatterns(patterns: readonly string[]): CompiledPattern[] {
  const unique = new Set(
    patterns
      .map((pattern) => pattern.trim())
      .filter((pattern) => pattern.length > 0)
  );
  const flags = platform() === 'win32' ? 'i' : '';
  return [...unique].map((pattern) => {
    const normalized = normalizePathForMatch(pattern);
    const matchesPath = normalized.includes('/');
    const escaped = escapeRegex(normalized).replace(/\*/gu, '.*');
    const source = matchesPath ? escaped : `^${escaped}$`;
    return {
      raw: normalized,
      regex: new RegExp(source, flags),
      matchesPath,
    };
  });
}

const DENY_PATTERNS = compilePatterns(SENSITIVE_FILE_DENYLIST);
const ALLOW_PATTERNS = compilePatterns(SENSITIVE_FILE_ALLOWLIST);

function matchesAny(
  patterns: readonly CompiledPattern[],
  pathCandidates: readonly string[],
  nameCandidates: readonly string[]
): boolean {
  for (const pattern of patterns) {
    const candidates = pattern.matchesPath ? pathCandidates : nameCandidates;
    for (const candidate of candidates) {
      if (pattern.regex.test(candidate)) return true;
    }
  }
  return false;
}

export function isSensitivePath(
  requestedPath: string,
  resolvedPath?: string
): boolean {
  if (DENY_PATTERNS.length === 0) return false;

  const normalizedRequested = normalizePathForMatch(requestedPath);
  const normalizedResolved = resolvedPath
    ? normalizePathForMatch(resolvedPath)
    : undefined;

  const pathCandidates = [
    normalizedRequested,
    ...(normalizedResolved && normalizedResolved !== normalizedRequested
      ? [normalizedResolved]
      : []),
  ];

  const nameCandidates = [
    path.basename(normalizedRequested),
    ...(normalizedResolved && normalizedResolved !== normalizedRequested
      ? [path.basename(normalizedResolved)]
      : []),
  ];

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
