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

interface GlobDirentLike extends DirentLike {
  name: string;
  parentPath?: string;
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

interface NormalizedGlob {
  cwd: string;
  patterns: readonly string[];
  exclude: readonly string[];
  useDirents: boolean;
  suppressErrors: boolean;
  maxDepth?: number;
}

function normalizeToPosixPath(filePath: string): string {
  return filePath.replace(/\\/gu, '/');
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

function buildHiddenPatterns(
  normalizedPattern: string,
  maxDepth: number
): readonly string[] {
  const patterns = new Set<string>();
  patterns.add(normalizedPattern);

  const { prefix, remainder } = splitPatternPrefix(normalizedPattern);
  const remainderSegments = remainder.length > 0 ? remainder.split('/') : [];

  // Dotfile candidate handling (e.g. foo/bar -> .foo/bar, foo/.bar)
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

  // Globstar handling (e.g. **/foo -> **/.*/**/foo, **/.foo)
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

function shouldUseGlobDirents(options: GlobEntriesOptions): boolean {
  return !options.stats && !options.followSymbolicLinks;
}

function normalizeOptions(options: GlobEntriesOptions): NormalizedGlob {
  const normalized = normalizePattern(options.pattern, options.baseNameMatch);
  const maxHiddenDepth = options.maxDepth ?? 10;

  const patterns = options.includeHidden
    ? buildHiddenPatterns(normalized, maxHiddenDepth)
    : [normalized];

  const result: NormalizedGlob = {
    cwd: options.cwd,
    patterns,
    exclude: normalizeIgnorePatterns(options.excludePatterns),
    useDirents: shouldUseGlobDirents(options),
    suppressErrors: options.suppressErrors ?? false,
  };

  if (options.maxDepth !== undefined) {
    result.maxDepth = options.maxDepth;
  }

  return result;
}

function resolveDepth(cwd: string, entryPath: string): number {
  const relative = path.relative(cwd, entryPath);
  if (relative.length === 0) return 0;
  const normalized = normalizeToPosixPath(relative);
  const parts = normalized.split('/').filter((part) => part.length > 0);
  return parts.length;
}

function isWithinDepthLimit(
  normalized: NormalizedGlob,
  entryPath: string
): boolean {
  if (normalized.maxDepth === undefined) return true;
  return resolveDepth(normalized.cwd, entryPath) <= normalized.maxDepth;
}

function toAbsolutePath(cwd: string, match: string): string {
  return path.isAbsolute(match) ? match : path.resolve(cwd, match);
}

function toAbsolutePathFromDirent(cwd: string, dirent: GlobDirentLike): string {
  const base =
    dirent.parentPath && dirent.parentPath.length > 0 ? dirent.parentPath : cwd;
  return path.resolve(base, dirent.name);
}

function isGlobDirentLike(value: unknown): value is GlobDirentLike {
  if (typeof value !== 'object' || value === null) return false;

  const v = value as Partial<GlobDirentLike>;
  return (
    typeof v.name === 'string' &&
    typeof v.isFile === 'function' &&
    typeof v.isDirectory === 'function' &&
    typeof v.isSymbolicLink === 'function'
  );
}

function resolveAbsolutePathFromGlobMatch(
  cwd: string,
  match: string | GlobDirentLike
): string {
  return typeof match === 'string'
    ? toAbsolutePath(cwd, match)
    : toAbsolutePathFromDirent(cwd, match);
}

function passesOnlyFilesFilter(
  dirent: DirentLike,
  onlyFiles: boolean
): boolean {
  return !onlyFiles || dirent.isFile();
}

function buildEntryFromGlobDirent(
  absolutePath: string,
  dirent: GlobDirentLike,
  options: GlobEntriesOptions
): GlobEntry | null {
  if (!passesOnlyFilesFilter(dirent, options.onlyFiles)) return null;
  return { path: absolutePath, dirent };
}

async function buildEntry(
  entryPath: string,
  options: GlobEntriesOptions
): Promise<GlobEntry | null> {
  try {
    const stats = options.followSymbolicLinks
      ? await fs.stat(entryPath)
      : await fs.lstat(entryPath);

    if (!passesOnlyFilesFilter(stats, options.onlyFiles)) {
      return null;
    }

    const result: GlobEntry = { path: entryPath, dirent: stats };
    if (options.stats) result.stats = stats;
    return result;
  } catch (error) {
    if (options.suppressErrors) return null;
    throw error;
  }
}

function tryCreateGlobIterable(
  pattern: string | readonly string[],
  normalized: NormalizedGlob
): AsyncIterable<string | GlobDirentLike> | null {
  try {
    return fsGlob(pattern as string | string[], {
      cwd: normalized.cwd,
      exclude: normalized.exclude,
      withFileTypes: normalized.useDirents,
    });
  } catch (error) {
    if (normalized.suppressErrors) return null;
    throw error;
  }
}

function shouldYieldEntry(
  absolutePath: string,
  normalized: NormalizedGlob,
  seen: Set<string>
): boolean {
  if (seen.has(absolutePath)) return false;
  seen.add(absolutePath);
  if (!isWithinDepthLimit(normalized, absolutePath)) return false;
  return true;
}

async function buildEntryFromMatch(
  match: string | GlobDirentLike,
  options: GlobEntriesOptions,
  normalized: NormalizedGlob,
  seen: Set<string>
): Promise<GlobEntry | null> {
  const absolutePath = resolveAbsolutePathFromGlobMatch(normalized.cwd, match);

  if (!shouldYieldEntry(absolutePath, normalized, seen)) {
    return null;
  }

  if (normalized.useDirents && isGlobDirentLike(match)) {
    return buildEntryFromGlobDirent(absolutePath, match, options);
  }

  return await buildEntry(absolutePath, options);
}

async function* scanPattern(
  pattern: string | readonly string[],
  options: GlobEntriesOptions,
  normalized: NormalizedGlob,
  seen: Set<string>
): AsyncGenerator<GlobEntry> {
  const iterable = tryCreateGlobIterable(pattern, normalized);
  if (!iterable) return;

  try {
    for await (const match of iterable) {
      const entry = await buildEntryFromMatch(match, options, normalized, seen);
      if (entry) yield entry;
    }
  } catch (error) {
    if (normalized.suppressErrors) return;
    throw error;
  }
}

async function* nativeGlobEntries(
  options: GlobEntriesOptions
): AsyncGenerator<GlobEntry> {
  const normalized = normalizeOptions(options);
  const seen = new Set<string>();

  yield* scanPattern(normalized.patterns, options, normalized, seen);
}

export async function* globEntries(
  options: GlobEntriesOptions
): AsyncGenerator<GlobEntry> {
  const engine = 'node:fs/promises.glob';

  const traceContext = shouldPublishOpsTrace()
    ? { op: 'globEntries', engine }
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
