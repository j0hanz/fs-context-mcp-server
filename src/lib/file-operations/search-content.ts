import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import RE2 from 're2';
import safeRegex from 'safe-regex2';

import type { ContentMatch, SearchContentResult } from '../../config.js';
import {
  DEFAULT_SEARCH_MAX_FILES,
  DEFAULT_SEARCH_TIMEOUT_MS,
  MAX_LINE_CONTENT_LENGTH,
  MAX_SEARCHABLE_FILE_SIZE,
  SEARCH_WORKERS,
} from '../constants.js';
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
}

export type ResolvedOptions = SearchOptions;

const INTERNAL_MAX_RESULTS = 500;

const DEFAULTS: SearchOptions = {
  filePattern: '**/*',
  excludePatterns: [],
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

export function mergeOptions(partial: SearchContentOptions): ResolvedOptions {
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

export interface ScanFileResult {
  readonly matches: readonly ContentMatch[];
  readonly matched: boolean;
  readonly skippedTooLarge: boolean;
  readonly skippedBinary: boolean;
}
export function validatePattern(
  pattern: string,
  options: MatcherOptions
): void {
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
  pendingAfter: PendingAfter[];
}

function makeContext(): ContextState {
  return { before: [], pendingAfter: [] };
}

function pushContext(ctx: ContextState, line: string, max: number): void {
  if (max <= 0) return;

  ctx.before.push(line);
  if (ctx.before.length > max) ctx.before.shift();

  for (const pending of ctx.pendingAfter) {
    if (pending.left <= 0) continue;
    pending.buffer.push(line);
    pending.left -= 1;
  }

  while (ctx.pendingAfter.length > 0 && ctx.pendingAfter[0]?.left === 0) {
    ctx.pendingAfter.shift();
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
): readline.Interface {
  const baseOptions = {
    input: handle.createReadStream({ encoding: 'utf-8', autoClose: false }),
    crlfDelay: Infinity,
  };
  const options = signal ? { ...baseOptions, signal } : baseOptions;
  return readline.createInterface(options);
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
  ctx: ContextState
): void {
  const contextBefore =
    contextLines > 0 ? ([...ctx.before] as readonly string[]) : undefined;
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
      ctx
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
  const rl = buildReadline(handle, signal);
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

export async function scanFileResolved(
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
export interface ResolvedFile {
  resolvedPath: string;
  requestedPath: string;
}

export interface ScanSummary {
  filesScanned: number;
  filesMatched: number;
  skippedTooLarge: number;
  skippedBinary: number;
  skippedInaccessible: number;
  truncated: boolean;
  stoppedReason: SearchContentResult['summary']['stoppedReason'];
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
    summary.truncated = true;
    summary.stoppedReason = 'timeout';
    return true;
  }
  if (summary.filesScanned >= maxFilesScanned) {
    summary.truncated = true;
    summary.stoppedReason = 'maxFiles';
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
  summary: ScanSummary
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

    summary.filesScanned++;
    yield resolved;
  }
}

function collectFilesStream(
  root: string,
  opts: ResolvedOptions,
  allowedDirs: readonly string[],
  signal: AbortSignal
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
    stream: collectFromStream(stream, opts, allowedDirs, signal, summary),
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
    summary.truncated = true;
    summary.stoppedReason = 'timeout';
    return true;
  }
  if (matchesCount >= maxResults) {
    summary.truncated = true;
    summary.stoppedReason = 'maxResults';
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
interface ScanRequest {
  type: 'scan';
  id: number;
  resolvedPath: string;
  requestedPath: string;
  pattern: string;
  matcherOptions: MatcherOptions;
  scanOptions: ScanFileOptions;
  maxMatches: number;
}

interface ScanResult {
  type: 'result';
  id: number;
  result: {
    matches: readonly ContentMatch[];
    matched: boolean;
    skippedTooLarge: boolean;
    skippedBinary: boolean;
  };
}

interface ScanError {
  type: 'error';
  id: number;
  error: string;
}

type WorkerResponse = ScanResult | ScanError;

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
  cancel: () => void;
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const currentFile = fileURLToPath(import.meta.url);
const isSourceContext = currentFile.endsWith('.ts');
const WORKER_SCRIPT_PATH = path.join(
  currentDir,
  isSourceContext ? 'search-worker.ts' : 'search-worker.js'
);

const MAX_RESPAWNS = 3;

type LogFn = (message: string) => void;

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

  for (const [, pending] of slot.pending) {
    pending.reject(new Error(`Worker error: ${error.message}`));
  }
  slot.pending.clear();

  slot.worker?.terminate().catch(() => {});
  slot.worker = null;
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
    for (const [, pending] of slot.pending) {
      pending.reject(error);
    }
    slot.pending.clear();
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
  let attempts = 0;
  let index = nextSlotIndex;

  while (attempts < slots.length) {
    const slot = slots[index];
    index = (index + 1) % slots.length;
    attempts++;

    if (slot && (slot.worker || slot.respawnCount < maxRespawns)) {
      return { slot, nextSlotIndex: index };
    }
  }

  return { slot: null, nextSlotIndex: index };
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
      execArgv: isSourceContext ? ['--import', 'tsx'] : undefined,
    };

    const worker = new Worker(WORKER_SCRIPT_PATH, workerOptions);

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

      worker.postMessage(scanRequest);
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
      worker.postMessage({ type: 'cancel', id });
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
    return { id, promise, cancel };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    this.log('Closing worker pool');

    for (const slot of this.slots) {
      for (const [, pending] of slot.pending) {
        pending.reject(new Error('Worker pool closed'));
      }
      slot.pending.clear();
    }

    const terminatePromises: Promise<number>[] = [];
    for (const slot of this.slots) {
      if (slot.worker) {
        slot.worker.postMessage({ type: 'shutdown' });
        terminatePromises.push(slot.worker.terminate());
        slot.worker = null;
      }
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

function getSearchWorkerPool(size: number, debug = false): SearchWorkerPool {
  if (size <= 0) {
    throw new Error('Pool size must be positive');
  }

  if (poolInstance && poolSize === size) {
    return poolInstance;
  }

  if (poolInstance) {
    void poolInstance.close();
  }

  poolInstance = new SearchWorkerPool({ size, debug });
  poolSize = size;

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
  return {
    pool: getSearchWorkerPool(SEARCH_WORKERS),
    pattern,
    matcherOptions,
    scanOptions,
    maxResults,
    maxInFlight: Math.min(SEARCH_WORKERS, Math.max(1, maxResults)),
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
  const races = [...inFlight].map((task) =>
    task.promise.then(
      (result) => ({ task, result }),
      (error: unknown) => ({
        task,
        error: error instanceof Error ? error : new Error(String(error)),
      })
    )
  );
  return await Promise.race(races);
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
  return isWorkerPoolAvailable() && SEARCH_WORKERS > 0;
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
  signal: AbortSignal
): Promise<SearchContentResult> {
  const matcherOptions = buildMatcherOptions(opts);
  const scanOptions = buildScanOptions(opts);
  const traceContext = buildTraceContext(opts);

  return await withOpsTrace(traceContext, async () => {
    validatePattern(pattern, matcherOptions);
    const { stream, summary } = collectFilesStream(
      root,
      opts,
      allowedDirs,
      signal
    );
    const matches = await scanMatches(
      stream,
      pattern,
      matcherOptions,
      scanOptions,
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
  const root = await validateExistingDirectory(basePath, options.signal);
  const { signal, cleanup } = createTimedAbortSignal(
    options.signal,
    opts.timeoutMs
  );
  const allowedDirs = getAllowedDirectories();

  try {
    return await executeSearch(root, pattern, opts, allowedDirs, signal);
  } finally {
    cleanup();
  }
}
