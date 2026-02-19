import * as diagnosticsChannel from 'node:diagnostics_channel';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { it } from 'node:test';

import {
  startPerfMeasure,
  withToolDiagnostics,
} from '../../../lib/observability.js';

interface EnvSnapshot {
  diagnostics?: string;
  diagnosticsDetail?: string;
}

function enableDiagnosticsEnv(): EnvSnapshot {
  const snapshot: EnvSnapshot = {};
  const diagnostics = process.env.FS_CONTEXT_DIAGNOSTICS;
  const diagnosticsDetail = process.env.FS_CONTEXT_DIAGNOSTICS_DETAIL;
  if (diagnostics !== undefined) {
    snapshot.diagnostics = diagnostics;
  }
  if (diagnosticsDetail !== undefined) {
    snapshot.diagnosticsDetail = diagnosticsDetail;
  }
  process.env.FS_CONTEXT_DIAGNOSTICS = '1';
  process.env.FS_CONTEXT_DIAGNOSTICS_DETAIL = '1';
  return snapshot;
}

function restoreDiagnosticsEnv(snapshot: EnvSnapshot): void {
  if (snapshot.diagnostics === undefined) {
    delete process.env.FS_CONTEXT_DIAGNOSTICS;
  } else {
    process.env.FS_CONTEXT_DIAGNOSTICS = snapshot.diagnostics;
  }

  if (snapshot.diagnosticsDetail === undefined) {
    delete process.env.FS_CONTEXT_DIAGNOSTICS_DETAIL;
  } else {
    process.env.FS_CONTEXT_DIAGNOSTICS_DETAIL = snapshot.diagnosticsDetail;
  }
}

async function flushPerformanceObserver(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

await it('startPerfMeasure includes tool context detail when available', async () => {
  const snapshot = enableDiagnosticsEnv();
  const published: unknown[] = [];
  const onMessage = (message: unknown): void => {
    published.push(message);
  };

  diagnosticsChannel.subscribe('filesystem-mcp:perf', onMessage);

  try {
    await withToolDiagnostics(
      'perf-context-test',
      async () => {
        const endMeasure = startPerfMeasure('perf.context.measure');
        assert.ok(endMeasure);
        await Promise.resolve();
        endMeasure?.(true);
        return { ok: true };
      },
      { path: '/tmp/perf-context-test.txt' }
    );

    await flushPerformanceObserver();

    const measureEvent = published.find(
      (
        entry
      ): entry is {
        phase?: unknown;
        name?: unknown;
        detail?: Record<string, unknown>;
      } =>
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { phase?: unknown }).phase === 'measure' &&
        (entry as { name?: unknown }).name === 'perf.context.measure'
    );

    assert.ok(measureEvent);
    assert.ok(measureEvent.detail);
    assert.strictEqual(measureEvent.detail['tool'], 'perf-context-test');
    assert.strictEqual(measureEvent.detail['ok'], true);
    assert.strictEqual(typeof measureEvent.detail['path'], 'string');
    assert.strictEqual((measureEvent.detail['path'] as string).length, 16);
  } finally {
    diagnosticsChannel.unsubscribe('filesystem-mcp:perf', onMessage);
    restoreDiagnosticsEnv(snapshot);
  }
});

await it('startPerfMeasure clears emitted measures from performance timeline', async () => {
  const snapshot = enableDiagnosticsEnv();
  const published: unknown[] = [];
  const onMessage = (message: unknown): void => {
    published.push(message);
  };

  diagnosticsChannel.subscribe('filesystem-mcp:perf', onMessage);

  try {
    await withToolDiagnostics('perf-clear-test', async () => {
      const endMeasure = startPerfMeasure('perf.clear.measure');
      assert.ok(endMeasure);
      endMeasure?.(true);
      return { ok: true };
    });

    await flushPerformanceObserver();

    const publishedMeasure = published.find(
      (
        entry
      ): entry is {
        phase?: unknown;
        name?: unknown;
      } =>
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { phase?: unknown }).phase === 'measure' &&
        (entry as { name?: unknown }).name === 'perf.clear.measure'
    );

    assert.ok(publishedMeasure);
    assert.strictEqual(
      performance.getEntriesByName('perf.clear.measure', 'measure').length,
      0
    );
  } finally {
    diagnosticsChannel.unsubscribe('filesystem-mcp:perf', onMessage);
    restoreDiagnosticsEnv(snapshot);
  }
});

await it('startPerfMeasure end callback is idempotent', async () => {
  const snapshot = enableDiagnosticsEnv();
  const published: unknown[] = [];
  const onMessage = (message: unknown): void => {
    published.push(message);
  };

  diagnosticsChannel.subscribe('filesystem-mcp:perf', onMessage);

  try {
    await withToolDiagnostics('perf-idempotent-test', async () => {
      const endMeasure = startPerfMeasure('perf.idempotent.measure');
      assert.ok(endMeasure);

      endMeasure?.(true);
      assert.doesNotThrow(() => {
        endMeasure?.(false);
      });

      return { ok: true };
    });

    await flushPerformanceObserver();

    const measureEvents = published.filter(
      (
        entry
      ): entry is {
        phase?: unknown;
        name?: unknown;
      } =>
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { phase?: unknown }).phase === 'measure' &&
        (entry as { name?: unknown }).name === 'perf.idempotent.measure'
    );

    assert.strictEqual(measureEvents.length, 1);
    assert.strictEqual(
      performance.getEntriesByName('perf.idempotent.measure', 'measure').length,
      0
    );
  } finally {
    diagnosticsChannel.unsubscribe('filesystem-mcp:perf', onMessage);
    restoreDiagnosticsEnv(snapshot);
  }
});
