import { createHash } from 'node:crypto';
import { channel, tracingChannel } from 'node:diagnostics_channel';
import {
  type EventLoopUtilization,
  monitorEventLoopDelay,
  performance,
  PerformanceObserver,
} from 'node:perf_hooks';
import { inspect } from 'node:util';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasBooleanOk(value: unknown): value is { ok: boolean } {
  return isObject(value) && typeof value['ok'] === 'boolean';
}

function resolveDiagnosticsOk(result: unknown): boolean | undefined {
  if (!isObject(result)) return undefined;
  if (result['isError'] === true) return false;
  if (hasBooleanOk(result)) return result.ok;

  const structured = result['structuredContent'];
  if (hasBooleanOk(structured)) return structured.ok;

  return undefined;
}

function resolvePrimitiveDiagnosticsMessage(
  error: unknown
): string | undefined {
  if (typeof error === 'string') return error;
  if (typeof error === 'number' || typeof error === 'boolean')
    return String(error);
  if (typeof error === 'bigint') return error.toString();
  if (typeof error === 'symbol') return error.description ?? 'symbol';
  return undefined;
}

function resolveObjectDiagnosticsMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (isObject(error) && typeof error['message'] === 'string') {
    return error['message'];
  }
  try {
    return inspect(error, { depth: 3, maxArrayLength: 50 });
  } catch {
    return undefined;
  }
}

function resolveDiagnosticsErrorMessage(error?: unknown): string | undefined {
  if (error === undefined || error === null) return undefined;
  return (
    resolvePrimitiveDiagnosticsMessage(error) ??
    resolveObjectDiagnosticsMessage(error)
  );
}

function resolveResultErrorMessage(result: unknown): string | undefined {
  if (!isObject(result)) return undefined;
  const { structuredContent } = result;
  if (!isObject(structuredContent)) return undefined;
  const { error } = structuredContent;
  if (!isObject(error)) return undefined;
  const { message } = error;
  return typeof message === 'string' ? message : undefined;
}

function logToolError(
  tool: string,
  durationMs: number,
  message?: string
): void {
  const rounded = durationMs.toFixed(1);
  const suffix = message ? `: ${message}` : '';
  console.error(`[ToolError] ${tool} failed in ${rounded}ms${suffix}`);
}

function captureEventLoopUtilization(): EventLoopUtilization {
  return performance.eventLoopUtilization();
}

function diffEventLoopUtilization(
  start: EventLoopUtilization
): EventLoopUtilization {
  return performance.eventLoopUtilization(start);
}

function elapsedMs(startMs: number): number {
  return performance.now() - startMs;
}

function toMs(nanos: number): number {
  return nanos / 1_000_000;
}

type DiagnosticsDetail = 0 | 1 | 2;

interface ToolDiagnosticsEvent {
  phase: 'start' | 'end';
  tool: string;
  durationMs?: number;
  ok?: boolean;
  error?: string;
  path?: string;
}

interface EventLoopDelayStats {
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  exceeds: number;
}

interface PerfToolDiagnosticsEvent {
  phase: 'end';
  tool: string;
  durationMs: number;
  elu: {
    idle: number;
    active: number;
    utilization: number;
  };
  eventLoopDelay?: EventLoopDelayStats;
}

interface PerfMeasureEvent {
  phase: 'measure';
  name: string;
  durationMs: number;
  detail?: unknown;
}

type PerfDiagnosticsEvent = PerfToolDiagnosticsEvent | PerfMeasureEvent;

export interface OpsTraceContext {
  op: string;
  engine?: string;
  tool?: string;
  path?: string;
  [key: string]: unknown;
}

const TOOL_CHANNEL = channel('fs-context:tool');
const PERF_CHANNEL = channel('fs-context:perf');
const OPS_TRACE = tracingChannel<unknown, OpsTraceContext>('fs-context:ops');
let perfObserver: PerformanceObserver | undefined;
let perfMeasureCounter = 0;

function buildEventLoopDelayStats(
  histogram: ReturnType<typeof monitorEventLoopDelay>
): EventLoopDelayStats | undefined {
  if (histogram.count === 0) return undefined;
  return {
    min: toMs(histogram.min),
    max: toMs(histogram.max),
    mean: toMs(histogram.mean),
    p50: toMs(histogram.percentile(50)),
    p95: toMs(histogram.percentile(95)),
    p99: toMs(histogram.percentile(99)),
    exceeds: histogram.exceeds,
  };
}

function parseEnvBoolean(name: string): boolean {
  const normalized = process.env[name]?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function parseDiagnosticsEnabled(): boolean {
  return parseEnvBoolean('FS_CONTEXT_DIAGNOSTICS');
}

function parseDiagnosticsDetail(): DiagnosticsDetail {
  const normalized = process.env['FS_CONTEXT_DIAGNOSTICS_DETAIL']?.trim();
  if (normalized === '2') return 2;
  if (normalized === '1') return 1;
  return 0;
}

function parseToolErrorLogging(): boolean {
  return parseEnvBoolean('FS_CONTEXT_TOOL_LOG_ERRORS');
}

interface DiagnosticsConfig {
  enabled: boolean;
  detail: DiagnosticsDetail;
  logToolErrors: boolean;
}

function readDiagnosticsConfig(): DiagnosticsConfig {
  return {
    enabled: parseDiagnosticsEnabled(),
    detail: parseDiagnosticsDetail(),
    logToolErrors: parseToolErrorLogging(),
  };
}

function hashPath(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function normalizePathForDiagnostics(
  pathValue: string,
  detail: DiagnosticsDetail
): string | undefined {
  if (detail === 0) return undefined;
  if (detail === 2) return pathValue;
  return hashPath(pathValue);
}

function normalizeOpsTraceContext(context: OpsTraceContext): OpsTraceContext {
  if (!context.path) return context;

  const detail = parseDiagnosticsDetail();
  const normalizedPath = normalizePathForDiagnostics(context.path, detail);

  if (!normalizedPath) {
    const sanitized: OpsTraceContext = { ...context };
    delete sanitized.path;
    return sanitized;
  }

  return { ...context, path: normalizedPath };
}

function publishStartEvent(
  tool: string,
  options: { path?: string } | undefined,
  detail: DiagnosticsDetail
): void {
  const event: ToolDiagnosticsEvent = { phase: 'start', tool };

  const normalizedPath = options?.path
    ? normalizePathForDiagnostics(options.path, detail)
    : undefined;

  if (normalizedPath !== undefined) {
    event.path = normalizedPath;
  }

  TOOL_CHANNEL.publish(event);
}

function publishEndEvent(
  tool: string,
  ok: boolean,
  durationMs: number,
  error?: unknown
): void {
  const event: ToolDiagnosticsEvent = {
    phase: 'end',
    tool,
    ok,
    durationMs,
  };

  const message = resolveDiagnosticsErrorMessage(error);
  if (message !== undefined) {
    event.error = message;
  }

  TOOL_CHANNEL.publish(event);
}

function publishPerfEndEvent(
  tool: string,
  durationMs: number,
  elu: ReturnType<typeof diffEventLoopUtilization>,
  eventLoopDelay?: EventLoopDelayStats
): void {
  PERF_CHANNEL.publish({
    phase: 'end',
    tool,
    durationMs,
    elu: {
      idle: elu.idle,
      active: elu.active,
      utilization: elu.utilization,
    },
    ...(eventLoopDelay ? { eventLoopDelay } : {}),
  } satisfies PerfDiagnosticsEvent);
}

function ensurePerfObserver(): void {
  if (perfObserver) return;

  perfObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const { detail } = entry as { detail?: unknown };
      PERF_CHANNEL.publish({
        phase: 'measure',
        name: entry.name,
        durationMs: entry.duration,
        ...(detail !== undefined ? { detail } : {}),
      } satisfies PerfDiagnosticsEvent);

      performance.clearMeasures(entry.name);
    }
  });

  perfObserver.observe({ entryTypes: ['measure'] });
}

function startToolDiagnostics(
  tool: string,
  options: { path?: string } | undefined,
  config: DiagnosticsConfig,
  shouldPublishTool: boolean,
  shouldPublishPerf: boolean
): {
  startMs: number;
  eluStart: ReturnType<typeof captureEventLoopUtilization> | undefined;
  eventLoopDelay: ReturnType<typeof monitorEventLoopDelay> | undefined;
} {
  const startMs = performance.now();
  const eluStart = shouldPublishPerf
    ? captureEventLoopUtilization()
    : undefined;
  const eventLoopDelay = shouldPublishPerf
    ? monitorEventLoopDelay()
    : undefined;

  if (eventLoopDelay) {
    eventLoopDelay.enable();
  }

  if (shouldPublishTool) {
    publishStartEvent(tool, options, config.detail);
  }

  return { startMs, eluStart, eventLoopDelay };
}

function finalizeToolDiagnostics(
  tool: string,
  startMs: number,
  options: {
    ok: boolean;
    error?: unknown;
    shouldPublishTool: boolean;
    shouldPublishPerf: boolean;
    eluStart: ReturnType<typeof captureEventLoopUtilization> | undefined;
    eventLoopDelay: ReturnType<typeof monitorEventLoopDelay> | undefined;
  }
): void {
  const durationMs = elapsedMs(startMs);
  let eventLoopDelay: EventLoopDelayStats | undefined;

  if (options.eventLoopDelay) {
    options.eventLoopDelay.disable();
    eventLoopDelay = buildEventLoopDelayStats(options.eventLoopDelay);
  }

  if (options.shouldPublishPerf && options.eluStart) {
    publishPerfEndEvent(
      tool,
      durationMs,
      diffEventLoopUtilization(options.eluStart),
      eventLoopDelay
    );
  }
  if (options.shouldPublishTool) {
    publishEndEvent(tool, options.ok, durationMs, options.error);
  }
}

async function runWithDiagnostics<T>(
  tool: string,
  run: () => Promise<T>,
  options: { path?: string } | undefined,
  config: DiagnosticsConfig,
  shouldPublishTool: boolean,
  shouldPublishPerf: boolean
): Promise<T> {
  const { startMs, eluStart, eventLoopDelay } = startToolDiagnostics(
    tool,
    options,
    config,
    shouldPublishTool,
    shouldPublishPerf
  );

  const finalizeOptions = {
    shouldPublishTool,
    shouldPublishPerf,
    eluStart,
    eventLoopDelay,
  };

  try {
    const result = await run();
    finalizeToolDiagnostics(tool, startMs, {
      ok: resolveDiagnosticsOk(result) ?? true,
      ...finalizeOptions,
    });
    return result;
  } catch (error: unknown) {
    finalizeToolDiagnostics(tool, startMs, {
      ok: false,
      error,
      ...finalizeOptions,
    });
    throw error;
  }
}

async function runWithErrorLogging<T>(
  tool: string,
  run: () => Promise<T>
): Promise<T> {
  const startMs = performance.now();

  try {
    const result = await run();
    const ok = resolveDiagnosticsOk(result);

    if (ok === false) {
      logToolError(tool, elapsedMs(startMs), resolveResultErrorMessage(result));
    }

    return result;
  } catch (error: unknown) {
    logToolError(
      tool,
      elapsedMs(startMs),
      resolveDiagnosticsErrorMessage(error)
    );
    throw error;
  }
}

export function shouldPublishOpsTrace(): boolean {
  return parseDiagnosticsEnabled() && OPS_TRACE.hasSubscribers;
}

export function publishOpsTraceStart(context: OpsTraceContext): void {
  OPS_TRACE.start.publish(normalizeOpsTraceContext(context));
}

export function publishOpsTraceEnd(context: OpsTraceContext): void {
  OPS_TRACE.end.publish(normalizeOpsTraceContext(context));
}

export function publishOpsTraceError(
  context: OpsTraceContext,
  error: unknown
): void {
  OPS_TRACE.error.publish({
    ...normalizeOpsTraceContext(context),
    error,
  });
}

export function startPerfMeasure(
  name: string,
  detail?: Record<string, unknown>
): ((ok?: boolean) => void) | undefined {
  const config = readDiagnosticsConfig();
  if (!config.enabled || !PERF_CHANNEL.hasSubscribers) return undefined;

  ensurePerfObserver();
  const id = (perfMeasureCounter += 1);
  const startMark = `${name}:start:${id}`;
  const endMark = `${name}:end:${id}`;
  performance.mark(startMark);

  return (ok?: boolean): void => {
    performance.mark(endMark);
    const finalDetail =
      ok === undefined
        ? detail
        : ({ ...(detail ?? {}), ok } satisfies Record<string, unknown>);

    if (finalDetail) {
      performance.measure(name, {
        start: startMark,
        end: endMark,
        detail: finalDetail,
      });
    } else {
      performance.measure(name, startMark, endMark);
    }

    performance.clearMarks(startMark);
    performance.clearMarks(endMark);
  };
}

export async function withPerfMeasure<T>(
  name: string,
  detail: Record<string, unknown> | undefined,
  run: () => Promise<T>
): Promise<T> {
  const endMeasure = startPerfMeasure(name, detail);
  let ok = false;

  try {
    const result = await run();
    ok = true;
    return result;
  } finally {
    endMeasure?.(ok);
  }
}

export async function withToolDiagnostics<T>(
  tool: string,
  run: () => Promise<T>,
  options?: { path?: string }
): Promise<T> {
  const config = readDiagnosticsConfig();

  if (!config.enabled) {
    if (!config.logToolErrors) return await run();
    return await runWithErrorLogging(tool, run);
  }

  const shouldPublishTool = TOOL_CHANNEL.hasSubscribers;
  const shouldPublishPerf = PERF_CHANNEL.hasSubscribers;

  if (!shouldPublishTool && !shouldPublishPerf) {
    return await run();
  }

  return await runWithDiagnostics(
    tool,
    run,
    options,
    config,
    shouldPublishTool,
    shouldPublishPerf
  );
}
