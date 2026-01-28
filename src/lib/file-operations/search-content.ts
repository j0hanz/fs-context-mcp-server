import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { ReadStream } from 'node:fs';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

import RE2 from 're2';
import safeRegex from 'safe-regex2';

import type { ContentMatch, SearchContentResult } from '../../config.js';
import {
  DEFAULT_EXCLUDE_PATTERNS,
  DEFAULT_SEARCH_MAX_FILES,
  DEFAULT_SEARCH_TIMEOUT_MS,
  MAX_LINE_CONTENT_LENGTH,
  MAX_SEARCHABLE_FILE_SIZE,
  SEARCH_WORKERS,
} from '../constants.js';
import { ErrorCode, McpError } from '../errors.js';
import {
  assertNotAborted,
  createTimedAbortSignal,
  isProbablyBinary,
  withAbort,
} from '../fs-helpers.js';
import {
  type OpsTraceContext,
  publishOpsTraceEnd,
  publishOpsTraceError,
  publishOpsTraceStart,
  shouldPublishOpsTrace,
} from '../observability.js';
import { assertAllowedFileAccess, isSensitivePath } from '../path-policy.js';
import {
  getAllowedDirectories,
  isPathWithinDirectories,
  normalizePath,
  toAccessDeniedWithHint,
  validateExistingDirectory,
  validateExistingPathDetailed,
} from '../path-validation.js';
import { globEntries } from './glob-engine.js';

interface SearchOptions {
  filePattern: string;
  excludePatterns: readonly string[];
  caseSensitive: boolean;
  maxResults: number;
  maxFileSize: number;
  maxFilesScanned: number;
  timeoutMs: number;
  skipBinary: boolean;
  contextLines: number;
  wholeWord: boolean;
  isLiteral: boolean;
  includeHidden: boolean;
  baseNameMatch: boolean;
  caseSensitiveFileMatch: boolean;
}

export interface SearchContentOptions extends Partial<SearchOptions> {
  signal?: AbortSignal;
  onProgress?: (progress: { total?: number; current: number }) => void;
}

type ResolvedOptions = SearchOptions;

const INTERNAL_MAX_RESULTS = 500;

const DEFAULTS: SearchOptions = {
  filePattern: '**/*',
  excludePatterns: DEFAULT_EXCLUDE_PATTERNS,
  caseSensitive: false,
  maxResults: INTERNAL_MAX_RESULTS,
  maxFileSize: MAX_SEARCHABLE_FILE_SIZE,
  maxFilesScanned: DEFAULT_SEARCH_MAX_FILES,
  timeoutMs: DEFAULT_SEARCH_TIMEOUT_MS,
  skipBinary: true,
  contextLines: 0,
  wholeWord: false,
  isLiteral: true,
  includeHidden: false,
  baseNameMatch: false,
  caseSensitiveFileMatch: true,
};

function mergeOptions(partial: SearchContentOptions): ResolvedOptions {
  const rest = { ...partial };
  delete rest.signal;
  return { ...DEFAULTS, ...rest };
}

export interface MatcherOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  isLiteral: boolean;
}

export type Matcher = (line: string) => number;

export interface ScanFileOptions {
  maxFileSize: number;
  skipBinary: boolean;
  contextLines: number;
}

interface ScanFileResult {
  readonly matches: readonly ContentMatch[];
  readonly matched: boolean;
  readonly skippedTooLarge: boolean;
  readonly skippedBinary: boolean;
}
function validatePattern(pattern: string, options: MatcherOptions): void {
  if (options.isLiteral && !options.wholeWord) {
    return;
  }

  const final = buildRegexPattern(pattern, options);
  assertSafePattern(final, pattern);
}

function escapeLiteral(pattern: string): string {
  return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRegexPattern(pattern: string, options: MatcherOptions): string {
  const escaped = options.isLiteral ? escapeLiteral(pattern) : pattern;
  return options.wholeWord ? `\\b${escaped}\\b` : escaped;
}

function assertSafePattern(final: string, original: string): void {
  if (!safeRegex(final)) {
    throw new Error(
      `Potentially unsafe regular expression (ReDoS risk): ${original}`
    );
  }
}

function buildLiteralMatcher(
  pattern: string,
  options: MatcherOptions
): Matcher {
  const needle = options.caseSensitive ? pattern : pattern.toLowerCase();
  return (line: string): number => {
    const hay = options.caseSensitive ? line : line.toLowerCase();
    if (needle.length === 0 || hay.length === 0) return 0;
    let count = 0;
    let pos = hay.indexOf(needle);
    while (pos !== -1) {
      count++;
      pos = hay.indexOf(needle, pos + needle.length);
    }
    return count;
  };
}

function buildRegexMatcher(final: string, caseSensitive: boolean): Matcher {
  const regex = new RE2(final, caseSensitive ? 'g' : 'gi');
  return (line: string): number => {
    regex.lastIndex = 0;
    let count = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line)) !== null) {
      count++;
      if (match[0].length === 0) {
        regex.lastIndex++;
      }
    }
    return count;
  };
}

export function buildMatcher(
  pattern: string,
  options: MatcherOptions
): Matcher {
  if (options.isLiteral && !options.wholeWord && !options.caseSensitive) {
    if (pattern.length === 0) {
      return (): number => 0;
    }

    return buildRegexMatcher(escapeLiteral(pattern), false);
  }

  if (options.isLiteral && !options.wholeWord) {
    return buildLiteralMatcher(pattern, options);
  }

  const final = buildRegexPattern(pattern, options);
  assertSafePattern(final, pattern);
  return buildRegexMatcher(final, options.caseSensitive);
}
interface PendingAfter {
  buffer: string[];
  left: number;
}

interface ContextState {
  before: string[];
  beforeStart: number;
  beforeSize: number;
  beforeCapacity: number;
  pendingAfter: PendingAfter[];
  pendingAfterStart: number;
}

function makeContext(): ContextState {
  return {
    before: [],
    beforeStart: 0,
    beforeSize: 0,
    beforeCapacity: 0,
    pendingAfter: [],
    pendingAfterStart: 0,
  };
}

function snapshotContextBefore(ctx: ContextState): string[] {
  if (ctx.beforeSize === 0) return [];
  const result = new Array<string>(ctx.beforeSize);
  for (let i = 0; i < ctx.beforeSize; i += 1) {
    const index = (ctx.beforeStart + i) % ctx.beforeCapacity;
    result[i] = ctx.before[index] ?? '';
  }
  return result;
}

function pushContext(ctx: ContextState, line: string, max: number): void {
  if (max <= 0) return;

  if (ctx.beforeCapacity !== max) {
    ctx.before = new Array<string>(max);
    ctx.beforeStart = 0;
    ctx.beforeSize = 0;
    ctx.beforeCapacity = max;
  }

  const insertIndex = (ctx.beforeStart + ctx.beforeSize) % ctx.beforeCapacity;
  ctx.before[insertIndex] = line;
  if (ctx.beforeSize < ctx.beforeCapacity) {
    ctx.beforeSize += 1;
  } else {
    ctx.beforeStart = (ctx.beforeStart + 1) % ctx.beforeCapacity;
  }

  for (
    let index = ctx.pendingAfterStart;
    index < ctx.pendingAfter.length;
    index += 1
  ) {
    const pending = ctx.pendingAfter[index];
    if (!pending) continue;
    if (pending.left <= 0) continue;
    pending.buffer.push(line);
    pending.left -= 1;
  }

  while (
    ctx.pendingAfterStart < ctx.pendingAfter.length &&
    ctx.pendingAfter[ctx.pendingAfterStart]?.left === 0
  ) {
    ctx.pendingAfterStart += 1;
  }

  if (ctx.pendingAfterStart >= ctx.pendingAfter.length) {
    ctx.pendingAfter = [];
    ctx.pendingAfterStart = 0;
  } else if (
    ctx.pendingAfterStart > 32 &&
    ctx.pendingAfterStart > ctx.pendingAfter.length / 2
  ) {
    ctx.pendingAfter = ctx.pendingAfter.slice(ctx.pendingAfterStart);
    ctx.pendingAfterStart = 0;
  }
}

function trimContent(line: string): string {
  return line.trimEnd().slice(0, MAX_LINE_CONTENT_LENGTH);
}

type BinaryDetector = (
  path: string,
  handle: fsp.FileHandle,
  signal?: AbortSignal
) => Promise<boolean>;

interface ScanLoopOptions {
  matcher: Matcher;
  options: ScanFileOptions;
  maxMatches: number;
  isCancelled: () => boolean;
  isProbablyBinary: BinaryDetector;
  signal?: AbortSignal;
}

function buildReadline(
  handle: fsp.FileHandle,
  signal?: AbortSignal
): { rl: readline.Interface; input: ReadStream } {
  const input = handle.createReadStream({
    encoding: 'utf-8',
    autoClose: false,
  });
  const baseOptions = {
    input,
    crlfDelay: Infinity,
  };
  const options = signal ? { ...baseOptions, signal } : baseOptions;
  const rl = readline.createInterface(options);
  return { rl, input };
}

function updateContext(
  line: string,
  contextLines: number,
  ctx: ContextState
): string | undefined {
  if (contextLines <= 0) return undefined;
  const trimmedLine = trimContent(line);
  pushContext(ctx, trimmedLine, contextLines);
  return trimmedLine;
}

function appendMatch(
  matches: ContentMatch[],
  requestedPath: string,
  line: string,
  trimmedLine: string | undefined,
  lineNo: number,
  count: number,
  contextLines: number,
  ctx: ContextState,
  contextBeforeOverride?: readonly string[]
): void {
  const contextBefore =
    contextLines > 0
      ? (contextBeforeOverride ?? snapshotContextBefore(ctx))
      : undefined;
  const contextAfterBuffer = contextLines > 0 ? [] : undefined;
  const match: ContentMatch = {
    file: requestedPath,
    line: lineNo,
    content: trimmedLine ?? trimContent(line),
    matchCount: count,
    ...(contextBefore ? { contextBefore } : {}),
    ...(contextAfterBuffer ? { contextAfter: contextAfterBuffer } : {}),
  };
  matches.push(match);
  if (contextAfterBuffer) {
    ctx.pendingAfter.push({
      buffer: contextAfterBuffer,
      left: contextLines,
    });
  }
}

function recordLineMatch(
  line: string,
  matcher: Matcher,
  options: ScanFileOptions,
  requestedPath: string,
  lineNo: number,
  matches: ContentMatch[],
  ctx: ContextState
): void {
  const contextBefore =
    options.contextLines > 0 ? snapshotContextBefore(ctx) : undefined;
  const trimmedLine = updateContext(line, options.contextLines, ctx);
  const count = matcher(line);
  if (count > 0) {
    appendMatch(
      matches,
      requestedPath,
      line,
      trimmedLine,
      lineNo,
      count,
      options.contextLines,
      ctx,
      contextBefore
    );
  }
}

async function readLoop(
  rl: readline.Interface,
  matcher: Matcher,
  options: ScanFileOptions,
  requestedPath: string,
  maxMatches: number,
  isCancelled: () => boolean,
  matches: ContentMatch[],
  ctx: ContextState
): Promise<void> {
  let lineNo = 0;
  for await (const line of rl) {
    if (isCancelled()) break;
    lineNo++;
    recordLineMatch(
      line,
      matcher,
      options,
      requestedPath,
      lineNo,
      matches,
      ctx
    );
    if (matches.length >= maxMatches) break;
  }
}

function buildSkipResult(
  skippedTooLarge: boolean,
  skippedBinary: boolean
): ScanFileResult {
  return {
    matches: [],
    matched: false,
    skippedTooLarge,
    skippedBinary,
  };
}

function buildMatchResult(matches: ContentMatch[]): ScanFileResult {
  return {
    matches,
    matched: matches.length > 0,
    skippedTooLarge: false,
    skippedBinary: false,
  };
}

async function shouldSkipBinary(
  scanOptions: ScanFileOptions,
  resolvedPath: string,
  handle: fsp.FileHandle,
  options: ScanLoopOptions
): Promise<boolean> {
  return (
    scanOptions.skipBinary &&
    (await options.isProbablyBinary(resolvedPath, handle, options.signal))
  );
}

async function readMatches(
  handle: fsp.FileHandle,
  requestedPath: string,
  matcher: Matcher,
  options: ScanFileOptions,
  maxMatches: number,
  isCancelled: () => boolean,
  signal?: AbortSignal
): Promise<ContentMatch[]> {
  const { rl, input } = buildReadline(handle, signal);
  const ctx = makeContext();
  const matches: ContentMatch[] = [];
  try {
    await readLoop(
      rl,
      matcher,
      options,
      requestedPath,
      maxMatches,
      isCancelled,
      matches,
      ctx
    );
    return matches;
  } finally {
    rl.close();
    input.destroy();
  }
}

async function scanWithHandle(
  handle: fsp.FileHandle,
  resolvedPath: string,
  requestedPath: string,
  options: ScanLoopOptions
): Promise<ScanFileResult> {
  const scanOptions = options.options;
  const stats = await withAbort(handle.stat(), options.signal);

  if (stats.size > scanOptions.maxFileSize) {
    return buildSkipResult(true, false);
  }

  if (await shouldSkipBinary(scanOptions, resolvedPath, handle, options)) {
    return buildSkipResult(false, true);
  }

  const matches = await readMatches(
    handle,
    requestedPath,
    options.matcher,
    scanOptions,
    options.maxMatches,
    options.isCancelled,
    options.signal
  );
  return buildMatchResult(matches);
}

async function scanFileWithMatcher(
  resolvedPath: string,
  requestedPath: string,
  options: ScanLoopOptions
): Promise<ScanFileResult> {
  assertNotAborted(options.signal);
  const handle = await withAbort(fsp.open(resolvedPath, 'r'), options.signal);

  try {
    return await scanWithHandle(handle, resolvedPath, requestedPath, options);
  } finally {
    await handle.close();
  }
}

async function scanFileResolved(
  resolvedPath: string,
  requestedPath: string,
  matcher: Matcher,
  options: ScanFileOptions,
  signal?: AbortSignal,
  maxMatches: number = Number.POSITIVE_INFINITY
): Promise<ScanFileResult> {
  const scanOptions: Parameters<typeof scanFileWithMatcher>[2] = {
    matcher,
    options,
    maxMatches,
    isCancelled: () => Boolean(signal?.aborted),
    isProbablyBinary,
  };
  if (signal) {
    scanOptions.signal = signal;
  }
  return scanFileWithMatcher(resolvedPath, requestedPath, scanOptions);
}

export async function scanFileInWorker(
  resolvedPath: string,
  requestedPath: string,
  matcher: Matcher,
  options: ScanFileOptions,
  maxMatches: number,
  isCancelled: () => boolean,
  isBinaryDetector: BinaryDetector
): Promise<{
  readonly matches: readonly ContentMatch[];
  readonly matched: boolean;
  readonly skippedTooLarge: boolean;
  readonly skippedBinary: boolean;
}> {
  const result = await scanFileWithMatcher(resolvedPath, requestedPath, {
    matcher,
    options,
    maxMatches,
    isCancelled,
    isProbablyBinary: isBinaryDetector,
  });
  return {
    matches: result.matches,
    matched: result.matched,
    skippedTooLarge: result.skippedTooLarge,
    skippedBinary: result.skippedBinary,
  };
}
interface ResolvedFile {
  resolvedPath: string;
  requestedPath: string;
}

interface ScanSummary {
  filesScanned: number;
  filesMatched: number;
  skippedTooLarge: number;
  skippedBinary: number;
  skippedInaccessible: number;
  truncated: boolean;
  stoppedReason: SearchContentResult['summary']['stoppedReason'];
}

async function executeSearchSingleFile(
  file: ResolvedFile,
  baseDir: string,
  pattern: string,
  opts: ResolvedOptions,
  signal: AbortSignal
): Promise<SearchContentResult> {
  return await withSearchExecution(pattern, opts, async (context) => {
    const summary = createScanSummary();
    const matches: ContentMatch[] = [];

    summary.filesScanned = 1;

    assertAllowedFileAccess(file.requestedPath, file.resolvedPath);

    const matcher = buildMatcher(pattern, context.matcherOptions);
    await scanSequentialFile(
      file,
      matcher,
      context.scanOptions,
      signal,
      opts.maxResults,
      matches,
      summary
    );

    shouldStopOnSignalOrLimit(signal, matches.length, opts.maxResults, summary);

    return buildSearchResult(
      baseDir,
      pattern,
      path.basename(file.requestedPath),
      matches,
      summary
    );
  });
}

function resolveNonSymlinkPath(
  entryPath: string,
  allowedDirs: readonly string[]
): ResolvedFile {
  const normalized = normalizePath(entryPath);
  if (!isPathWithinDirectories(normalized, allowedDirs)) {
    throw toAccessDeniedWithHint(entryPath, normalized, normalized);
  }
  return { resolvedPath: normalized, requestedPath: normalized };
}

function createScanSummary(): ScanSummary {
  return {
    filesScanned: 0,
    filesMatched: 0,
    skippedTooLarge: 0,
    skippedBinary: 0,
    skippedInaccessible: 0,
    truncated: false,
    stoppedReason: undefined,
  };
}

function shouldStopCollecting(
  summary: ScanSummary,
  maxFilesScanned: number,
  signal: AbortSignal
): boolean {
  if (signal.aborted) {
    markTruncated(summary, 'timeout');
    return true;
  }
  if (summary.filesScanned >= maxFilesScanned) {
    markTruncated(summary, 'maxFiles');
    return true;
  }
  return false;
}

async function resolveEntryPath(
  entry: { path: string; dirent: { isSymbolicLink(): boolean } },
  allowedDirs: readonly string[],
  signal: AbortSignal
): Promise<ResolvedFile | null> {
  try {
    return entry.dirent.isSymbolicLink()
      ? await validateExistingPathDetailed(entry.path, signal)
      : resolveNonSymlinkPath(entry.path, allowedDirs);
  } catch {
    return null;
  }
}

async function* collectFromStream(
  stream: AsyncIterable<{
    path: string;
    dirent: { isFile(): boolean; isSymbolicLink(): boolean };
  }>,
  opts: ResolvedOptions,
  allowedDirs: readonly string[],
  signal: AbortSignal,
  summary: ScanSummary,
  onProgress?: (progress: { total?: number; current: number }) => void
): AsyncGenerator<ResolvedFile> {
  for await (const entry of stream) {
    if (!entry.dirent.isFile()) continue;
    if (shouldStopCollecting(summary, opts.maxFilesScanned, signal)) {
      break;
    }

    const resolved = await resolveEntryPath(entry, allowedDirs, signal);
    if (!resolved) {
      summary.skippedInaccessible++;
      continue;
    }

    if (isSensitivePath(resolved.requestedPath, resolved.resolvedPath)) {
      summary.skippedInaccessible++;
      continue;
    }

    summary.filesScanned++;
    if (onProgress && summary.filesScanned % 50 === 0) {
      onProgress({ current: summary.filesScanned });
    }
    yield resolved;
  }
}

function collectFilesStream(
  root: string,
  opts: ResolvedOptions,
  allowedDirs: readonly string[],
  signal: AbortSignal,
  onProgress?: (progress: { total?: number; current: number }) => void
): { stream: AsyncGenerator<ResolvedFile>; summary: ScanSummary } {
  const summary = createScanSummary();

  const stream = globEntries({
    cwd: root,
    pattern: opts.filePattern,
    excludePatterns: opts.excludePatterns,
    includeHidden: opts.includeHidden,
    baseNameMatch: opts.baseNameMatch,
    caseSensitiveMatch: opts.caseSensitiveFileMatch,
    followSymbolicLinks: false,
    onlyFiles: true,
    stats: false,
    suppressErrors: true,
  });

  return {
    stream: collectFromStream(
      stream,
      opts,
      allowedDirs,
      signal,
      summary,
      onProgress
    ),
    summary,
  };
}

interface ScanResultLike {
  matches: readonly ContentMatch[];
  matched: boolean;
  skippedTooLarge: boolean;
  skippedBinary: boolean;
}

function shouldStopOnSignalOrLimit(
  signal: AbortSignal,
  matchesCount: number,
  maxResults: number,
  summary: ScanSummary
): boolean {
  if (signal.aborted) {
    markTruncated(summary, 'timeout');
    return true;
  }
  if (matchesCount >= maxResults) {
    markTruncated(summary, 'maxResults');
    return true;
  }
  return false;
}

function applyScanResult(
  result: ScanResultLike,
  matches: ContentMatch[],
  summary: ScanSummary,
  remaining: number
): void {
  if (result.skippedTooLarge) summary.skippedTooLarge++;
  if (result.skippedBinary) summary.skippedBinary++;
  if (result.matched) summary.filesMatched++;
  if (result.matches.length > 0 && remaining > 0) {
    matches.push(...result.matches.slice(0, remaining));
  }
}

async function scanSequentialFile(
  file: ResolvedFile,
  matcher: ReturnType<typeof buildMatcher>,
  scanOptions: ScanFileOptions,
  signal: AbortSignal,
  maxResults: number,
  matches: ContentMatch[],
  summary: ScanSummary
): Promise<void> {
  try {
    const remaining = maxResults - matches.length;
    const result = await scanFileResolved(
      file.resolvedPath,
      file.requestedPath,
      matcher,
      scanOptions,
      signal,
      remaining
    );
    applyScanResult(result, matches, summary, remaining);
  } catch {
    summary.skippedInaccessible++;
  }
}

async function collectSequentialMatches(
  files: AsyncIterable<ResolvedFile>,
  matcher: ReturnType<typeof buildMatcher>,
  scanOptions: ScanFileOptions,
  maxResults: number,
  signal: AbortSignal,
  summary: ScanSummary
): Promise<ContentMatch[]> {
  const matches: ContentMatch[] = [];
  for await (const file of files) {
    if (
      shouldStopOnSignalOrLimit(signal, matches.length, maxResults, summary)
    ) {
      break;
    }
    await scanSequentialFile(
      file,
      matcher,
      scanOptions,
      signal,
      maxResults,
      matches,
      summary
    );
  }
  return matches;
}

async function scanFilesSequential(
  files: AsyncIterable<ResolvedFile>,
  pattern: string,
  matcherOptions: MatcherOptions,
  scanOptions: ScanFileOptions,
  maxResults: number,
  signal: AbortSignal,
  summary: ScanSummary
): Promise<ContentMatch[]> {
  const matcher = buildMatcher(pattern, matcherOptions);
  return await collectSequentialMatches(
    files,
    matcher,
    scanOptions,
    maxResults,
    signal,
    summary
  );
}
export interface ScanRequest {
  type: 'scan';
  id: number;
  resolvedPath: string;
  requestedPath: string;
  pattern: string;
  matcherOptions: MatcherOptions;
  scanOptions: ScanFileOptions;
  maxMatches: number;
}

export interface ScanResult {
  type: 'result';
  id: number;
  result: {
    matches: readonly ContentMatch[];
    matched: boolean;
    skippedTooLarge: boolean;
    skippedBinary: boolean;
  };
}

export interface ScanError {
  type: 'error';
  id: number;
  error: string;
}

export type WorkerResponse = ScanResult | ScanError;

interface PendingTask {
  resolve: (result: ScanResult['result']) => void;
  reject: (error: Error) => void;
  request: ScanRequest;
}

interface WorkerSlot {
  worker: Worker | null;
  pending: Map<number, PendingTask>;
  respawnCount: number;
  index: number;
}

interface PoolOptions {
  size: number;
  debug?: boolean;
}

interface WorkerScanRequest {
  resolvedPath: string;
  requestedPath: string;
  pattern: string;
  matcherOptions: MatcherOptions;
  scanOptions: ScanFileOptions;
  maxMatches: number;
}

interface WorkerScanResult {
  matches: readonly ContentMatch[];
  matched: boolean;
  skippedTooLarge: boolean;
  skippedBinary: boolean;
}

interface ScanTask {
  id: number;
  promise: Promise<WorkerScanResult>;
  outcome: Promise<WorkerOutcome>;
  cancel: () => void;
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const currentFile = fileURLToPath(import.meta.url);
const isSourceContext = currentFile.endsWith('.ts');
const WORKER_SCRIPT_PATH = path.join(
  currentDir,
  isSourceContext ? 'search-worker.ts' : 'search-worker.js'
);
const WORKER_SCRIPT_URL = pathToFileURL(WORKER_SCRIPT_PATH);

const MAX_RESPAWNS = 3;

type LogFn = (message: string) => void;

function rejectPendingTasks(slot: WorkerSlot, error: Error): void {
  for (const [, pending] of slot.pending) {
    pending.reject(error);
  }
  slot.pending.clear();
}

function terminateWorker(slot: WorkerSlot): void {
  slot.worker?.terminate().catch(() => {});
  slot.worker = null;
}

function handleWorkerMessage(
  slot: WorkerSlot,
  message: WorkerResponse,
  log: LogFn
): void {
  const pending = slot.pending.get(message.id);
  if (!pending) {
    log(`Received message for unknown request ${String(message.id)}`);
    return;
  }

  slot.pending.delete(message.id);

  if (message.type === 'result') {
    pending.resolve(message.result);
  } else {
    pending.reject(new Error(message.error));
  }
}

function handleWorkerError(slot: WorkerSlot, error: Error, log: LogFn): void {
  log(`Worker ${String(slot.index)} error: ${error.message}`);

  rejectPendingTasks(slot, new Error(`Worker error: ${error.message}`));
  terminateWorker(slot);
}

function handleWorkerExit(
  slot: WorkerSlot,
  code: number,
  isClosed: boolean,
  maxRespawns: number,
  log: LogFn
): void {
  log(`Worker ${String(slot.index)} exited with code ${String(code)}`);

  if (isClosed) {
    return;
  }

  if (slot.pending.size > 0) {
    const error = new Error(
      `Worker exited unexpectedly with code ${String(code)}`
    );
    rejectPendingTasks(slot, error);
  }

  slot.worker = null;

  if (code !== 0 && slot.respawnCount < maxRespawns) {
    slot.respawnCount++;
    log(
      `Worker ${String(slot.index)} will be respawned on next request (attempt ${String(slot.respawnCount)}/${String(maxRespawns)})`
    );
  } else if (slot.respawnCount >= maxRespawns) {
    log(`Worker ${String(slot.index)} exceeded max respawns, slot disabled`);
  }
}

function selectSlot(
  slots: WorkerSlot[],
  nextSlotIndex: number,
  maxRespawns: number
): { slot: WorkerSlot | null; nextSlotIndex: number } {
  let bestSlot: WorkerSlot | null = null;
  let bestNextSlotIndex = nextSlotIndex;
  let bestPending = Number.POSITIVE_INFINITY;

  for (let offset = 0; offset < slots.length; offset++) {
    const index = (nextSlotIndex + offset) % slots.length;
    const slot = slots[index];
    if (!slot) continue;
    if (!slot.worker && slot.respawnCount >= maxRespawns) continue;

    const pendingSize = slot.pending.size;
    if (pendingSize < bestPending) {
      bestSlot = slot;
      bestPending = pendingSize;
      bestNextSlotIndex = (index + 1) % slots.length;
      if (bestPending === 0) break;
    }
  }

  return { slot: bestSlot, nextSlotIndex: bestNextSlotIndex };
}

function attachWorkerHandlers(
  worker: Worker,
  slot: WorkerSlot,
  getClosed: () => boolean,
  maxRespawns: number,
  log: LogFn
): void {
  worker.on('message', (message: WorkerResponse) => {
    handleWorkerMessage(slot, message, log);
  });

  worker.on('error', (error: Error) => {
    handleWorkerError(slot, error, log);
  });

  worker.on('exit', (code: number) => {
    handleWorkerExit(slot, code, getClosed(), maxRespawns, log);
  });
}

class SearchWorkerPool {
  private readonly slots: WorkerSlot[];
  private readonly debug: boolean;
  private nextRequestId = 0;
  private nextSlotIndex = 0;
  private closed = false;

  constructor(options: PoolOptions) {
    this.debug = options.debug ?? false;
    this.slots = [];

    for (let i = 0; i < options.size; i++) {
      this.slots.push({
        worker: null,
        pending: new Map(),
        respawnCount: 0,
        index: i,
      });
    }
  }

  private log(message: string): void {
    if (this.debug) {
      console.error(`[SearchWorkerPool] ${message}`);
    }
  }

  private spawnWorker(slot: WorkerSlot): Worker {
    this.log(`Spawning worker for slot ${String(slot.index)}`);
    const workerOptions = {
      workerData: {
        debug: this.debug,
        threadId: slot.index,
      },
      type: 'module',
      execArgv: isSourceContext ? ['--import', 'tsx/esm'] : undefined,
    };

    const worker = new Worker(WORKER_SCRIPT_URL, workerOptions);

    worker.unref();
    const logEntry = (entry: string): void => {
      this.log(entry);
    };
    attachWorkerHandlers(
      worker,
      slot,
      () => this.closed,
      MAX_RESPAWNS,
      logEntry
    );

    return worker;
  }

  private getWorker(slot: WorkerSlot): Worker {
    slot.worker ??= this.spawnWorker(slot);
    return slot.worker;
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error('Worker pool is closed');
    }
  }

  private selectAvailableSlot(): WorkerSlot {
    const selection = selectSlot(this.slots, this.nextSlotIndex, MAX_RESPAWNS);
    this.nextSlotIndex = selection.nextSlotIndex;
    if (!selection.slot) {
      throw new Error('All worker slots are disabled');
    }
    return selection.slot;
  }

  private buildScanRequest(
    id: number,
    request: WorkerScanRequest
  ): ScanRequest {
    return {
      type: 'scan',
      id,
      ...request,
    };
  }

  private createScanPromise(
    slot: WorkerSlot,
    worker: Worker,
    scanRequest: ScanRequest
  ): Promise<WorkerScanResult> {
    let settled = false;
    return new Promise<WorkerScanResult>((resolve, reject) => {
      const safeResolve = (result: WorkerScanResult): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const safeReject = (error: Error): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      slot.pending.set(scanRequest.id, {
        resolve: safeResolve,
        reject: safeReject,
        request: scanRequest,
      });

      try {
        worker.postMessage(scanRequest);
      } catch (error: unknown) {
        slot.pending.delete(scanRequest.id);
        safeReject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private createCancel(
    slot: WorkerSlot,
    worker: Worker,
    id: number
  ): () => void {
    return (): void => {
      const pending = slot.pending.get(id);
      if (!pending) return;
      slot.pending.delete(id);
      try {
        worker.postMessage({ type: 'cancel', id });
      } catch {
        // Ignore: cancellation should still reject the local pending promise.
      }
      pending.reject(new Error('Scan cancelled'));
    };
  }

  scan(request: WorkerScanRequest): ScanTask {
    this.ensureOpen();
    const slot = this.selectAvailableSlot();
    const worker = this.getWorker(slot);
    const id = this.nextRequestId++;
    const scanRequest = this.buildScanRequest(id, request);
    const promise = this.createScanPromise(slot, worker, scanRequest);
    const cancel = this.createCancel(slot, worker, id);
    const outcome = promise.then(
      (result) => ({ task, result }),
      (error: unknown) => ({
        task,
        error: error instanceof Error ? error : new Error(String(error)),
      })
    );
    const task: ScanTask = { id, promise, cancel, outcome };
    return task;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    this.log('Closing worker pool');

    for (const slot of this.slots) {
      rejectPendingTasks(slot, new Error('Worker pool closed'));
    }

    const terminatePromises: Promise<number>[] = [];
    for (const slot of this.slots) {
      if (!slot.worker) continue;
      try {
        slot.worker.postMessage({ type: 'shutdown' });
      } catch {
        // Ignore: worker may already be terminating.
      }
      terminatePromises.push(slot.worker.terminate());
      slot.worker = null;
    }

    await Promise.allSettled(terminatePromises);
    this.log('Worker pool closed');
  }
}

function isWorkerPoolAvailable(): boolean {
  return !isSourceContext;
}

let poolInstance: SearchWorkerPool | null = null;
let poolSize = 0;
let poolDebug = false;

function getSearchWorkerPool(size: number, debug = false): SearchWorkerPool {
  if (size <= 0) {
    throw new Error('Pool size must be positive');
  }

  if (poolInstance && poolSize === size && poolDebug === debug) {
    return poolInstance;
  }

  if (poolInstance) {
    void poolInstance.close();
  }

  poolInstance = new SearchWorkerPool({ size, debug });
  poolSize = size;
  poolDebug = debug;

  return poolInstance;
}
interface WorkerOutcome {
  task: ScanTask;
  result?: WorkerScanResult;
  error?: Error;
}

interface ParallelScanState {
  matches: ContentMatch[];
  summary: ScanSummary;
  inFlight: Set<ScanTask>;
  iterator: AsyncIterator<ResolvedFile>;
  done: boolean;
  stoppedEarly: boolean;
}

interface ParallelScanConfig {
  pool: ReturnType<typeof getSearchWorkerPool>;
  pattern: string;
  matcherOptions: MatcherOptions;
  scanOptions: ScanFileOptions;
  maxResults: number;
  maxInFlight: number;
  signal: AbortSignal;
}

function createParallelScanConfig(
  pattern: string,
  matcherOptions: MatcherOptions,
  scanOptions: ScanFileOptions,
  maxResults: number,
  signal: AbortSignal
): ParallelScanConfig {
  const debug = process.env['FS_CONTEXT_SEARCH_WORKERS_DEBUG'] === '1';
  return {
    pool: getSearchWorkerPool(SEARCH_WORKERS, debug),
    pattern,
    matcherOptions,
    scanOptions,
    maxResults,
    maxInFlight: Math.max(1, SEARCH_WORKERS),
    signal,
  };
}

function createParallelScanState(
  files: AsyncIterable<ResolvedFile>,
  summary: ScanSummary
): ParallelScanState {
  return {
    matches: [],
    summary,
    inFlight: new Set<ScanTask>(),
    iterator: files[Symbol.asyncIterator](),
    done: false,
    stoppedEarly: false,
  };
}

function markTruncated(
  summary: ScanSummary,
  reason: ScanSummary['stoppedReason']
): void {
  summary.truncated = true;
  summary.stoppedReason = reason;
}

function cancelInFlight(inFlight: Set<ScanTask>): void {
  for (const task of inFlight) {
    task.cancel();
    void task.promise.catch(() => {});
  }
  inFlight.clear();
}

function stopIfSignaledOrLimited(
  config: ParallelScanConfig,
  state: ParallelScanState
): boolean {
  if (
    !shouldStopOnSignalOrLimit(
      config.signal,
      state.matches.length,
      config.maxResults,
      state.summary
    )
  ) {
    return false;
  }
  state.stoppedEarly = true;
  state.done = true;
  cancelInFlight(state.inFlight);
  return true;
}

async function awaitNextOutcome(
  inFlight: Set<ScanTask>
): Promise<WorkerOutcome> {
  function* outcomes(): Iterable<Promise<WorkerOutcome>> {
    for (const task of inFlight) {
      yield task.outcome;
    }
  }

  return await Promise.race(outcomes());
}

function handleWorkerOutcome(
  outcome: WorkerOutcome,
  config: ParallelScanConfig,
  state: ParallelScanState
): void {
  state.inFlight.delete(outcome.task);
  if (outcome.error) {
    if (outcome.error.message !== 'Scan cancelled') {
      state.summary.skippedInaccessible++;
    }
    return;
  }
  const { result } = outcome;
  if (!result) return;
  const remaining = config.maxResults - state.matches.length;
  if (remaining <= 0) {
    markTruncated(state.summary, 'maxResults');
    return;
  }
  applyScanResult(result, state.matches, state.summary, remaining);
  if (state.matches.length >= config.maxResults) {
    markTruncated(state.summary, 'maxResults');
  }
}

async function enqueueNextTask(
  config: ParallelScanConfig,
  state: ParallelScanState
): Promise<void> {
  if (stopIfSignaledOrLimited(config, state)) return;
  const next = await state.iterator.next();
  if (next.done) {
    state.done = true;
    return;
  }
  const remaining = Math.max(1, config.maxResults - state.matches.length);
  const task = config.pool.scan({
    resolvedPath: next.value.resolvedPath,
    requestedPath: next.value.requestedPath,
    pattern: config.pattern,
    matcherOptions: config.matcherOptions,
    scanOptions: config.scanOptions,
    maxMatches: remaining,
  });
  state.inFlight.add(task);
}

async function fillInFlight(
  config: ParallelScanConfig,
  state: ParallelScanState
): Promise<void> {
  while (!state.done && state.inFlight.size < config.maxInFlight) {
    await enqueueNextTask(config, state);
  }
}

async function drainInFlight(
  config: ParallelScanConfig,
  state: ParallelScanState
): Promise<void> {
  await fillInFlight(config, state);
  while (state.inFlight.size > 0) {
    if (stopIfSignaledOrLimited(config, state)) break;
    handleWorkerOutcome(await awaitNextOutcome(state.inFlight), config, state);
    if (stopIfSignaledOrLimited(config, state)) break;
    await fillInFlight(config, state);
  }
}

async function finalizeParallelScan(state: ParallelScanState): Promise<void> {
  if (!state.stoppedEarly) return;
  cancelInFlight(state.inFlight);
  await state.iterator.return?.();
}

function attachAbortHandler(
  config: ParallelScanConfig,
  state: ParallelScanState
): () => void {
  const onAbort = (): void => {
    state.stoppedEarly = true;
    markTruncated(state.summary, 'timeout');
    cancelInFlight(state.inFlight);
  };
  config.signal.addEventListener('abort', onAbort, { once: true });
  return onAbort;
}

async function scanFilesParallel(
  files: AsyncIterable<ResolvedFile>,
  pattern: string,
  matcherOptions: MatcherOptions,
  scanOptions: ScanFileOptions,
  maxResults: number,
  signal: AbortSignal,
  summary: ScanSummary
): Promise<ContentMatch[]> {
  const config = createParallelScanConfig(
    pattern,
    matcherOptions,
    scanOptions,
    maxResults,
    signal
  );
  const state = createParallelScanState(files, summary);
  const onAbort = attachAbortHandler(config, state);
  try {
    await drainInFlight(config, state);
    await finalizeParallelScan(state);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  return state.matches;
}

function buildMatcherOptions(opts: ResolvedOptions): MatcherOptions {
  return {
    caseSensitive: opts.caseSensitive,
    wholeWord: opts.wholeWord,
    isLiteral: opts.isLiteral,
  };
}

function buildScanOptions(opts: ResolvedOptions): ScanFileOptions {
  return {
    maxFileSize: opts.maxFileSize,
    skipBinary: opts.skipBinary,
    contextLines: opts.contextLines,
  };
}

function shouldUseWorkers(): boolean {
  // Multi-CPU only: require at least 2 workers to justify thread overhead.
  return isWorkerPoolAvailable() && SEARCH_WORKERS >= 2;
}

function buildTraceContext(opts: ResolvedOptions): OpsTraceContext | undefined {
  if (!shouldPublishOpsTrace()) return undefined;
  return {
    op: 'searchContent',
    engine: shouldUseWorkers() ? 'workers' : 'sequential',
    maxResults: opts.maxResults,
  };
}

async function withOpsTrace<T>(
  context: OpsTraceContext | undefined,
  run: () => Promise<T>
): Promise<T> {
  if (!context) {
    return await run();
  }
  publishOpsTraceStart(context);
  try {
    return await run();
  } catch (error: unknown) {
    publishOpsTraceError(context, error);
    throw error;
  } finally {
    publishOpsTraceEnd(context);
  }
}

interface SearchExecutionContext {
  matcherOptions: MatcherOptions;
  scanOptions: ScanFileOptions;
  traceContext: OpsTraceContext | undefined;
}

function buildSearchExecution(opts: ResolvedOptions): SearchExecutionContext {
  return {
    matcherOptions: buildMatcherOptions(opts),
    scanOptions: buildScanOptions(opts),
    traceContext: buildTraceContext(opts),
  };
}

async function withSearchExecution<T>(
  pattern: string,
  opts: ResolvedOptions,
  run: (context: SearchExecutionContext) => Promise<T>
): Promise<T> {
  const context = buildSearchExecution(opts);
  return await withOpsTrace(context.traceContext, async () => {
    validatePattern(pattern, context.matcherOptions);
    return await run(context);
  });
}

async function scanMatches(
  files: AsyncIterable<ResolvedFile>,
  pattern: string,
  matcherOptions: MatcherOptions,
  scanOptions: ScanFileOptions,
  maxResults: number,
  signal: AbortSignal,
  summary: ScanSummary
): Promise<SearchContentResult['matches']> {
  if (shouldUseWorkers()) {
    return await scanFilesParallel(
      files,
      pattern,
      matcherOptions,
      scanOptions,
      maxResults,
      signal,
      summary
    );
  }
  return await scanFilesSequential(
    files,
    pattern,
    matcherOptions,
    scanOptions,
    maxResults,
    signal,
    summary
  );
}

function buildSummary(
  summary: ScanSummary,
  matches: SearchContentResult['matches']
): SearchContentResult['summary'] {
  const baseSummary: SearchContentResult['summary'] = {
    filesScanned: summary.filesScanned,
    filesMatched: summary.filesMatched,
    matches: matches.length,
    truncated: summary.truncated,
    skippedTooLarge: summary.skippedTooLarge,
    skippedBinary: summary.skippedBinary,
    skippedInaccessible: summary.skippedInaccessible,
    linesSkippedDueToRegexTimeout: 0,
  };
  return {
    ...baseSummary,
    ...(summary.stoppedReason !== undefined
      ? { stoppedReason: summary.stoppedReason }
      : {}),
  };
}

function buildSearchResult(
  root: string,
  pattern: string,
  filePattern: string,
  matches: SearchContentResult['matches'],
  summary: ScanSummary
): SearchContentResult {
  return {
    basePath: root,
    pattern,
    filePattern,
    matches,
    summary: buildSummary(summary, matches),
  };
}

async function executeSearch(
  root: string,
  pattern: string,
  opts: ResolvedOptions,
  allowedDirs: readonly string[],
  signal: AbortSignal,
  onProgress?: (progress: { total?: number; current: number }) => void
): Promise<SearchContentResult> {
  return await withSearchExecution(pattern, opts, async (context) => {
    const { stream, summary } = collectFilesStream(
      root,
      opts,
      allowedDirs,
      signal,
      onProgress
    );
    const matches = await scanMatches(
      stream,
      pattern,
      context.matcherOptions,
      context.scanOptions,
      opts.maxResults,
      signal,
      summary
    );
    return buildSearchResult(root, pattern, opts.filePattern, matches, summary);
  });
}

export async function searchContent(
  basePath: string,
  pattern: string,
  options: SearchContentOptions = {}
): Promise<SearchContentResult> {
  const opts = mergeOptions(options);
  const { signal, cleanup } = createTimedAbortSignal(
    options.signal,
    opts.timeoutMs
  );
  const allowedDirs = getAllowedDirectories();

  try {
    const details = await validateExistingPathDetailed(basePath, signal);
    const stats = await withAbort(fsp.stat(details.resolvedPath), signal);

    if (stats.isDirectory()) {
      const root = await validateExistingDirectory(
        details.resolvedPath,
        signal
      );
      return await executeSearch(
        root,
        pattern,
        opts,
        allowedDirs,
        signal,
        options.onProgress
      );
    }

    if (stats.isFile()) {
      const baseDir = path.dirname(details.requestedPath);
      return await executeSearchSingleFile(
        {
          resolvedPath: details.resolvedPath,
          requestedPath: details.requestedPath,
        },
        baseDir,
        pattern,
        opts,
        signal
      );
    }

    throw new McpError(
      ErrorCode.E_INVALID_INPUT,
      `Path must be a file or directory: ${basePath}`,
      basePath
    );
  } finally {
    cleanup();
  }
}
