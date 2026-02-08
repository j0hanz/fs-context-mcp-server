import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Stats } from 'node:fs';
import { glob as fsGlob } from 'node:fs/promises';

import {
  publishOpsTraceEnd,
  publishOpsTraceError,
  publishOpsTraceStart,
  shouldPublishOpsTrace,
  startPerfMeasure,
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

type GlobMatch = string | GlobDirentLike;

interface NormalizedGlob {
  cwd: string;
  patterns: readonly string[];
  exclude: readonly string[];
  useDirents: boolean;
  suppressErrors: boolean;
  maxDepth?: number;
}

const GLOB_MAGIC_RE = /[*?[\]{}!]/u;
const DEFAULT_MAX_HIDDEN_DEPTH = 10;

function toPosixSlashes(value: string): string {
  return value.replace(/\\/gu, '/');
}

function normalizePattern(pattern: string, baseNameMatch: boolean): string {
  const normalized = toPosixSlashes(pattern);

  if (!baseNameMatch) return normalized;
  if (normalized.includes('/')) return normalized;
  return `**/${normalized}`;
}

function normalizeIgnorePatterns(
  patterns: readonly string[]
): readonly string[] {
  return patterns.map(toPosixSlashes);
}

function hasGlobMagic(segment: string): boolean {
  return GLOB_MAGIC_RE.test(segment);
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
  const patterns = new Set<string>([normalizedPattern]);

  const { prefix, remainder } = splitPatternPrefix(normalizedPattern);
  const remainderSegments = remainder.length > 0 ? remainder.split('/') : [];

  // Dotfile candidate handling:
  // - only modifies the first non-"**" segment within the glob-capable remainder
  // - does not make literal prefix segments match dot-prefixed variants
  // Example: foo/bar -> foo/.bar (not .foo/bar)
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

  // Globstar handling:
  // If the remainder starts with "**/", expand patterns to match hidden directories at various depths.
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
  // fs.promises.glob supports `withFileTypes`, but does not provide stats nor symlink-following.
  // If either is needed, we'll glob as strings and stat/lstat afterwards.
  return !options.stats && !options.followSymbolicLinks;
}

function normalizeOptions(options: GlobEntriesOptions): NormalizedGlob {
  const normalizedPattern = normalizePattern(
    options.pattern,
    options.baseNameMatch
  );
  const maxHiddenDepth = options.maxDepth ?? DEFAULT_MAX_HIDDEN_DEPTH;

  const patterns = options.includeHidden
    ? buildHiddenPatterns(normalizedPattern, maxHiddenDepth)
    : [normalizedPattern];

  const normalized: NormalizedGlob = {
    cwd: options.cwd,
    patterns,
    exclude: normalizeIgnorePatterns(options.excludePatterns),
    useDirents: shouldUseGlobDirents(options),
    suppressErrors: options.suppressErrors ?? false,
  };

  if (options.maxDepth !== undefined) {
    normalized.maxDepth = options.maxDepth;
  }

  return normalized;
}

function resolveDepth(cwd: string, entryPath: string): number {
  const relative = path.relative(cwd, entryPath);
  if (relative.length === 0) return 0;

  const normalized = toPosixSlashes(relative);
  const parts = normalized.split('/').filter((part) => part.length > 0);

  return parts.length;
}

function isWithinDepthLimit(plan: NormalizedGlob, entryPath: string): boolean {
  if (plan.maxDepth === undefined) return true;
  return resolveDepth(plan.cwd, entryPath) <= plan.maxDepth;
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

function resolveAbsolutePathFromMatch(cwd: string, match: GlobMatch): string {
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

async function buildEntryFromPath(
  absolutePath: string,
  options: GlobEntriesOptions,
  suppressErrors: boolean
): Promise<GlobEntry | null> {
  try {
    const stats = options.followSymbolicLinks
      ? await fs.stat(absolutePath)
      : await fs.lstat(absolutePath);

    if (!passesOnlyFilesFilter(stats, options.onlyFiles)) return null;

    const entry: GlobEntry = { path: absolutePath, dirent: stats };
    if (options.stats) entry.stats = stats;
    return entry;
  } catch (error) {
    if (suppressErrors) return null;
    throw error;
  }
}

function createGlobIterable(
  pattern: string | readonly string[],
  plan: NormalizedGlob
): AsyncIterable<GlobMatch> | null {
  try {
    return fsGlob(pattern as string | string[], {
      cwd: plan.cwd,
      exclude: plan.exclude,
      withFileTypes: plan.useDirents,
    }) as AsyncIterable<GlobMatch>;
  } catch (error) {
    if (plan.suppressErrors) return null;
    throw error;
  }
}

function shouldYieldEntry(
  absolutePath: string,
  plan: NormalizedGlob,
  seen: Set<string>
): boolean {
  if (!isWithinDepthLimit(plan, absolutePath)) return false;
  if (seen.has(absolutePath)) return false;

  seen.add(absolutePath);
  return true;
}

async function buildEntryFromMatch(
  match: GlobMatch,
  options: GlobEntriesOptions,
  plan: NormalizedGlob,
  seen: Set<string>
): Promise<GlobEntry | null> {
  const absolutePath = resolveAbsolutePathFromMatch(plan.cwd, match);

  if (!shouldYieldEntry(absolutePath, plan, seen)) return null;

  if (plan.useDirents && isGlobDirentLike(match)) {
    return buildEntryFromGlobDirent(absolutePath, match, options);
  }

  return await buildEntryFromPath(absolutePath, options, plan.suppressErrors);
}

async function* scanPattern(
  pattern: string | readonly string[],
  options: GlobEntriesOptions,
  plan: NormalizedGlob,
  seen: Set<string>
): AsyncGenerator<GlobEntry> {
  const iterable = createGlobIterable(pattern, plan);
  if (!iterable) return;

  try {
    for await (const match of iterable) {
      const entry = await buildEntryFromMatch(match, options, plan, seen);
      if (entry) yield entry;
    }
  } catch (error) {
    if (plan.suppressErrors) return;
    throw error;
  }
}

async function* nativeGlobEntries(
  options: GlobEntriesOptions
): AsyncGenerator<GlobEntry> {
  const plan = normalizeOptions(options);
  const seen = new Set<string>();

  yield* scanPattern(plan.patterns, options, plan, seen);
}

export async function* globEntries(
  options: GlobEntriesOptions
): AsyncGenerator<GlobEntry> {
  const engine = 'node:fs/promises.glob';

  const endMeasure = startPerfMeasure('globEntries', { engine });
  const traceContext = shouldPublishOpsTrace()
    ? { op: 'globEntries', engine }
    : undefined;

  if (traceContext) publishOpsTraceStart(traceContext);

  let ok = false;
  try {
    yield* nativeGlobEntries(options);
    ok = true;
  } catch (error: unknown) {
    if (traceContext) publishOpsTraceError(traceContext, error);
    throw error;
  } finally {
    if (traceContext) publishOpsTraceEnd(traceContext);
    endMeasure?.(ok);
  }
}
