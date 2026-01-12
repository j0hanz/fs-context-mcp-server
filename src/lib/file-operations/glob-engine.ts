import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Stats } from 'node:fs';
import { glob as fsGlob } from 'node:fs/promises';

import {
  publishOpsTraceEnd,
  publishOpsTraceError,
  publishOpsTraceStart,
  shouldPublishOpsTrace,
} from '../observability.js';

interface DirentLike {
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface GlobEntry {
  path: string;
  dirent: DirentLike;
  stats?: Stats;
}

export interface GlobEntriesOptions {
  cwd: string;
  pattern: string;
  excludePatterns: readonly string[];
  includeHidden: boolean;
  baseNameMatch: boolean;
  caseSensitiveMatch: boolean;
  maxDepth?: number;
  followSymbolicLinks: boolean;
  onlyFiles: boolean;
  stats: boolean;
  suppressErrors?: boolean;
}

function normalizePattern(pattern: string, baseNameMatch: boolean): string {
  const normalized = pattern.replace(/\\/gu, '/');
  if (!baseNameMatch) return normalized;
  if (normalized.includes('/')) return normalized;
  return `**/${normalized}`;
}

function normalizeIgnorePatterns(
  patterns: readonly string[]
): readonly string[] {
  return patterns.map((pattern) => pattern.replace(/\\/gu, '/'));
}

function hasGlobMagic(segment: string): boolean {
  return /[*?[\]{}!]/u.test(segment);
}

function splitPatternPrefix(normalizedPattern: string): {
  prefix: string;
  remainder: string;
} {
  const segments = normalizedPattern.split('/');
  let splitIndex = segments.length;

  for (let i = 0; i < segments.length; i += 1) {
    if (hasGlobMagic(segments[i] ?? '')) {
      splitIndex = i;
      break;
    }
  }

  if (splitIndex === 0) {
    return { prefix: '', remainder: normalizedPattern };
  }

  if (splitIndex >= segments.length) {
    const last = segments[segments.length - 1] ?? '';
    const prefixSegments = segments.slice(0, Math.max(0, segments.length - 1));
    const prefix =
      prefixSegments.length > 0 ? `${prefixSegments.join('/')}/` : '';
    return { prefix, remainder: last };
  }

  const prefixSegments = segments.slice(0, splitIndex);
  const remainderSegments = segments.slice(splitIndex);
  return {
    prefix: `${prefixSegments.join('/')}/`,
    remainder: remainderSegments.join('/'),
  };
}

function normalizeToPosixPath(filePath: string): string {
  return filePath.replace(/\\/gu, '/');
}

function buildHiddenPatterns(
  normalizedPattern: string,
  maxDepth: number
): readonly string[] {
  const patterns = new Set<string>();
  patterns.add(normalizedPattern);

  const { prefix, remainder } = splitPatternPrefix(normalizedPattern);
  const remainderSegments = remainder.length > 0 ? remainder.split('/') : [];

  const dotfileSegments = [...remainderSegments];
  const firstCandidateIndex = dotfileSegments.findIndex(
    (segment) => segment !== '**' && segment.length > 0
  );
  if (firstCandidateIndex !== -1) {
    const original = dotfileSegments[firstCandidateIndex] ?? '';
    if (!original.startsWith('.')) {
      dotfileSegments[firstCandidateIndex] = `.${original}`;
      patterns.add(`${prefix}${dotfileSegments.join('/')}`);
    }
  }

  if (remainder.startsWith('**/')) {
    const afterGlobstar = remainder.slice('**/'.length);

    for (let depth = 0; depth <= maxDepth; depth += 1) {
      const depthPrefix = depth > 0 ? '*/'.repeat(depth) : '';

      patterns.add(`${prefix}${depthPrefix}.*/**/${afterGlobstar}`);

      if (afterGlobstar.length > 0 && !afterGlobstar.startsWith('.')) {
        patterns.add(`${prefix}${depthPrefix}.${afterGlobstar}`);
      }
    }
  }

  return [...patterns];
}

function toAbsolutePath(cwd: string, match: string): string {
  return path.isAbsolute(match) ? match : path.resolve(cwd, match);
}

function isWithinDepthLimit(
  options: GlobEntriesOptions,
  entryPath: string
): boolean {
  if (options.maxDepth === undefined) return true;
  return resolveDepth(options.cwd, entryPath) <= options.maxDepth;
}

function createGlobIterator(
  pattern: string,
  cwd: string,
  exclude: readonly string[],
  suppressErrors: boolean
): NodeJS.AsyncIterator<string> | null {
  try {
    return fsGlob(pattern, {
      cwd,
      exclude,
    });
  } catch (error) {
    if (suppressErrors) return null;
    throw error;
  }
}

async function* scanPattern(
  pattern: string,
  options: GlobEntriesOptions,
  exclude: readonly string[],
  seen: Set<string>
): AsyncGenerator<GlobEntry> {
  const iterator = createGlobIterator(
    pattern,
    options.cwd,
    exclude,
    options.suppressErrors ?? false
  );
  if (!iterator) return;

  try {
    for await (const match of iterator) {
      const absolutePath = toAbsolutePath(options.cwd, match);
      if (seen.has(absolutePath)) continue;
      seen.add(absolutePath);
      if (!isWithinDepthLimit(options, absolutePath)) continue;

      const entry = await buildEntry(absolutePath, options);
      if (!entry) continue;
      if (options.onlyFiles && !entry.dirent.isFile()) continue;
      yield entry;
    }
  } catch (error) {
    if (options.suppressErrors) return;
    throw error;
  }
}

function resolveDepth(cwd: string, entryPath: string): number {
  const relative = path.relative(cwd, entryPath);
  if (relative.length === 0) return 0;
  const normalized = normalizeToPosixPath(relative);
  const parts = normalized.split('/').filter((part) => part.length > 0);
  return parts.length;
}

async function buildEntry(
  entryPath: string,
  options: GlobEntriesOptions
): Promise<GlobEntry | null> {
  try {
    const stats = options.followSymbolicLinks
      ? await fs.stat(entryPath)
      : await fs.lstat(entryPath);
    const result: GlobEntry = {
      path: entryPath,
      dirent: stats,
    };
    if (options.stats) result.stats = stats;
    return result;
  } catch (error) {
    if (options.suppressErrors) {
      return null;
    }
    throw error;
  }
}

async function* nativeGlobEntries(
  options: GlobEntriesOptions
): AsyncGenerator<GlobEntry> {
  const normalized = normalizePattern(options.pattern, options.baseNameMatch);
  const maxHiddenDepth = options.maxDepth ?? 10;
  const patterns = options.includeHidden
    ? buildHiddenPatterns(normalized, maxHiddenDepth)
    : [normalized];

  const exclude = normalizeIgnorePatterns(options.excludePatterns);
  const seen = new Set<string>();

  for (const pattern of patterns) {
    yield* scanPattern(pattern, options, exclude, seen);
  }
}

export async function* globEntries(
  options: GlobEntriesOptions
): AsyncGenerator<GlobEntry> {
  const engine = 'node:fs/promises.glob';

  const traceContext = shouldPublishOpsTrace()
    ? {
        op: 'globEntries',
        engine,
      }
    : undefined;
  if (traceContext) publishOpsTraceStart(traceContext);

  try {
    yield* nativeGlobEntries(options);
  } catch (error: unknown) {
    if (traceContext) publishOpsTraceError(traceContext, error);
    throw error;
  } finally {
    if (traceContext) publishOpsTraceEnd(traceContext);
  }
}
