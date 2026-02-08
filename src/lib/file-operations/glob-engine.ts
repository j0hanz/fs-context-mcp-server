import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Stats } from 'node:fs';
import { glob as fsGlob } from 'node:fs/promises';

import {
  getToolContextSnapshot,
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
const SEP = '/';
const WIN_SEP = '\\';

function toPosixSlashes(value: string): string {
  return value.includes(WIN_SEP) ? value.replace(/\\/gu, SEP) : value;
}

function normalizePattern(pattern: string, baseNameMatch: boolean): string {
  const normalized = toPosixSlashes(pattern);

  if (!baseNameMatch) return normalized;
  if (normalized.includes(SEP)) return normalized;
  return `**/${normalized}`;
}

function normalizeIgnorePatterns(
  patterns: readonly string[]
): readonly string[] {
  return patterns.map(toPosixSlashes);
}

function splitPatternPrefix(normalizedPattern: string): {
  prefix: string;
  remainder: string;
} {
  if (!GLOB_MAGIC_RE.test(normalizedPattern)) {
    return { prefix: '', remainder: normalizedPattern };
  }

  const segments = normalizedPattern.split(SEP);
  const len = segments.length;
  let splitIndex = len;

  for (let i = 0; i < len; i++) {
    const seg = segments[i];
    if (seg && GLOB_MAGIC_RE.test(seg)) {
      splitIndex = i;
      break;
    }
  }

  if (splitIndex === 0) {
    return { prefix: '', remainder: normalizedPattern };
  }

  if (splitIndex >= len) {
    const prefix = segments.slice(0, len - 1).join(SEP);
    const last = segments[len - 1];
    return {
      prefix: prefix ? prefix + SEP : '',
      remainder: last ?? '',
    };
  }

  return {
    prefix: segments.slice(0, splitIndex).join(SEP) + SEP,
    remainder: segments.slice(splitIndex).join(SEP),
  };
}

function addDotfileCandidates(
  patterns: Set<string>,
  prefix: string,
  remainderSegments: string[]
): void {
  const firstCandidateIndex = remainderSegments.findIndex(
    (segment) => segment !== '**' && segment.length > 0
  );

  if (firstCandidateIndex !== -1) {
    const original = remainderSegments[firstCandidateIndex];
    // NOTE: Fixes the original bitwise-AND bug that prevented dotfile candidates.
    if (original && original.charCodeAt(0) !== 46 /* . */) {
      const newSegments = remainderSegments.slice();
      newSegments[firstCandidateIndex] = `.${original}`;
      patterns.add(`${prefix}${newSegments.join(SEP)}`);
    }
  }
}

function addGlobstarCandidates(
  patterns: Set<string>,
  prefix: string,
  remainder: string,
  maxDepth: number
): void {
  const afterGlobstar = remainder.slice(3);
  for (let depth = 0; depth <= maxDepth; depth++) {
    const depthPrefix = depth > 0 ? '*/'.repeat(depth) : '';
    patterns.add(`${prefix}${depthPrefix}.*/**/${afterGlobstar}`);
    if (afterGlobstar && afterGlobstar.charCodeAt(0) !== 46 /* . */) {
      patterns.add(`${prefix}${depthPrefix}.${afterGlobstar}`);
    }
  }
}

function buildHiddenPatterns(
  normalizedPattern: string,
  maxDepth: number
): readonly string[] {
  const patterns = new Set<string>();
  patterns.add(normalizedPattern);

  const { prefix, remainder } = splitPatternPrefix(normalizedPattern);

  if (remainder.length > 0) {
    const remainderSegments = remainder.split(SEP);
    addDotfileCandidates(patterns, prefix, remainderSegments);
  }

  if (remainder.startsWith('**/')) {
    addGlobstarCandidates(patterns, prefix, remainder, maxDepth);
  }

  return Array.from(patterns);
}

function shouldUseGlobDirents(options: GlobEntriesOptions): boolean {
  return !options.stats && !options.followSymbolicLinks;
}

function assertOptionsShape(options: GlobEntriesOptions): void {
  const unknownOptions: unknown = options;

  if (unknownOptions === null || typeof unknownOptions !== 'object') {
    throw new TypeError('globEntries: options must be an object');
  }

  const o = unknownOptions as Record<string, unknown>;

  if (typeof o.cwd !== 'string') {
    throw new TypeError('globEntries: options.cwd must be a string');
  }
  if (typeof o.pattern !== 'string') {
    throw new TypeError('globEntries: options.pattern must be a string');
  }

  if (!Array.isArray(o.excludePatterns)) {
    throw new TypeError(
      'globEntries: options.excludePatterns must be an array'
    );
  }
  for (const p of o.excludePatterns) {
    if (typeof p !== 'string') {
      throw new TypeError(
        'globEntries: options.excludePatterns must contain only strings'
      );
    }
  }

  const boolKeys: (keyof GlobEntriesOptions)[] = [
    'includeHidden',
    'baseNameMatch',
    'caseSensitiveMatch',
    'followSymbolicLinks',
    'onlyFiles',
    'stats',
  ];
  for (const key of boolKeys) {
    if (typeof o[key] !== 'boolean') {
      throw new TypeError(`globEntries: options.${key} must be a boolean`);
    }
  }

  if (o.maxDepth !== undefined) {
    if (typeof o.maxDepth !== 'number' || !Number.isFinite(o.maxDepth)) {
      throw new TypeError(
        'globEntries: options.maxDepth must be a finite number'
      );
    }
  }

  if (o.suppressErrors !== undefined && typeof o.suppressErrors !== 'boolean') {
    throw new TypeError(
      'globEntries: options.suppressErrors must be a boolean'
    );
  }
}

function normalizeOptions(options: GlobEntriesOptions): NormalizedGlob {
  const cwd = path.resolve(options.cwd);
  const normalizedPattern = normalizePattern(
    options.pattern,
    options.baseNameMatch
  );

  const maxHiddenDepth = options.maxDepth ?? DEFAULT_MAX_HIDDEN_DEPTH;
  const patterns = options.includeHidden
    ? buildHiddenPatterns(normalizedPattern, maxHiddenDepth)
    : [normalizedPattern];

  const normalized: NormalizedGlob = {
    cwd,
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

function getRelativeDepth(relativePath: string): number {
  if (relativePath.length === 0) return 0;
  let count = 0;
  for (let i = 0; i < relativePath.length; i++) {
    const code = relativePath.charCodeAt(i);
    if (code === 47 || code === 92) {
      count++;
    }
  }
  return count + 1;
}

function isGlobDirentLike(value: unknown): value is GlobDirentLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof (value as { name: unknown }).name === 'string'
  );
}

function resolveDirentBase(
  cwd: string,
  parentPath: string | undefined
): string {
  if (!parentPath) return cwd;
  // If parentPath is relative, interpret it relative to cwd (not process.cwd()).
  return path.isAbsolute(parentPath)
    ? parentPath
    : path.resolve(cwd, parentPath);
}

function resolveStringMatchPath(cwd: string, match: string): string {
  return path.isAbsolute(match) ? match : path.resolve(cwd, match);
}

// Helper to yield entries for directory entries (Dirent)
function* processDirentMatch(
  match: GlobDirentLike,
  cwd: string,
  maxDepth: number | undefined,
  seen: Set<string>,
  onlyFiles: boolean
): Generator<GlobEntry> {
  const base = resolveDirentBase(cwd, match.parentPath);
  const absolutePath = path.resolve(base, match.name);

  if (maxDepth !== undefined) {
    const rel = path.relative(cwd, absolutePath);
    if (getRelativeDepth(rel) > maxDepth) return;
  }

  if (seen.has(absolutePath)) return;
  seen.add(absolutePath);

  if (onlyFiles && !match.isFile()) return;
  yield { path: absolutePath, dirent: match };
}

// Helper to yield entries for string matches
async function* processStringMatch(
  match: string,
  cwd: string,
  maxDepth: number | undefined,
  seen: Set<string>,
  onlyFiles: boolean,
  followSymlinks: boolean,
  returnStats: boolean,
  suppressErrors: boolean
): AsyncGenerator<GlobEntry> {
  // Optimization: check depth on the relative string BEFORE resolving absolute path
  if (maxDepth !== undefined) {
    const depth = getRelativeDepth(match);
    if (depth > maxDepth) return;
  }

  const absolutePath = resolveStringMatchPath(cwd, match);

  if (seen.has(absolutePath)) return;
  seen.add(absolutePath);

  try {
    const stats = followSymlinks
      ? await fs.stat(absolutePath)
      : await fs.lstat(absolutePath);

    if (onlyFiles && !stats.isFile()) return;

    const entry: GlobEntry = { path: absolutePath, dirent: stats };
    if (returnStats) entry.stats = stats;
    yield entry;
  } catch (error) {
    if (!suppressErrors) throw error;
  }
}

async function* processIterable(
  iterable: AsyncIterable<GlobMatch>,
  context: {
    cwd: string;
    maxDepth: number | undefined;
    seen: Set<string>;
    onlyFiles: boolean;
    followSymlinks: boolean;
    returnStats: boolean;
    suppressErrors: boolean;
  }
): AsyncGenerator<GlobEntry> {
  const {
    cwd,
    maxDepth,
    seen,
    onlyFiles,
    followSymlinks,
    returnStats,
    suppressErrors,
  } = context;

  try {
    for await (const match of iterable) {
      if (typeof match === 'string') {
        yield* processStringMatch(
          match,
          cwd,
          maxDepth,
          seen,
          onlyFiles,
          followSymlinks,
          returnStats,
          suppressErrors
        );
        continue;
      }

      if (isGlobDirentLike(match)) {
        yield* processDirentMatch(match, cwd, maxDepth, seen, onlyFiles);
      }
    }
  } catch (error) {
    if (!suppressErrors) throw error;
  }
}

async function* nativeGlobEntries(
  options: GlobEntriesOptions
): AsyncGenerator<GlobEntry> {
  const plan = normalizeOptions(options);
  const seen = new Set<string>();

  const { cwd, maxDepth, suppressErrors } = plan;
  const {
    onlyFiles,
    stats: returnStats,
    followSymbolicLinks: followSymlinks,
  } = options;

  const context = {
    cwd,
    maxDepth,
    seen,
    onlyFiles,
    followSymlinks,
    returnStats,
    suppressErrors,
  };

  for (const pattern of plan.patterns) {
    let iterable: AsyncIterable<GlobMatch>;
    try {
      iterable = fsGlob(pattern, {
        cwd,
        exclude: plan.exclude,
        withFileTypes: plan.useDirents,
      }) as AsyncIterable<GlobMatch>;
    } catch (error) {
      if (suppressErrors) continue;
      throw error;
    }

    yield* processIterable(iterable, context);
  }
}

export async function* globEntries(
  options: GlobEntriesOptions
): AsyncGenerator<GlobEntry> {
  const engine = 'node:fs/promises.glob';

  const endMeasure = startPerfMeasure('globEntries', { engine });
  const toolContext = getToolContextSnapshot();
  const traceContext = shouldPublishOpsTrace()
    ? {
        op: 'globEntries',
        engine,
        ...(toolContext
          ? { tool: toolContext.tool, path: toolContext.path }
          : {}),
      }
    : undefined;

  if (traceContext) publishOpsTraceStart(traceContext);

  let ok = false;
  try {
    assertOptionsShape(options);
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
