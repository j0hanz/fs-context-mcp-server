import * as diagnosticsChannel from 'node:diagnostics_channel';
import assert from 'node:assert/strict';
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
  const snapshot: EnvSnapshot = {
    diagnostics: process.env.FS_CONTEXT_DIAGNOSTICS,
    diagnosticsDetail: process.env.FS_CONTEXT_DIAGNOSTICS_DETAIL,
  };
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

await it('startPerfMeasure includes tool context detail when available', async () => {
  const snapshot = enableDiagnosticsEnv();
  const published: unknown[] = [];
  const onMessage = (message: unknown): void => {
    published.push(message);
  };

  diagnosticsChannel.subscribe('fs-context:perf', onMessage);

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

    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

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
    diagnosticsChannel.unsubscribe('fs-context:perf', onMessage);
    restoreDiagnosticsEnv(snapshot);
  }
});
