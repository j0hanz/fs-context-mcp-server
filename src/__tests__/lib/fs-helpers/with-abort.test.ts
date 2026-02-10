import assert from 'node:assert/strict';
import { it } from 'node:test';

import { assertNotAborted, withAbort } from '../../../lib/fs-helpers.js';

void it('withAbort resolves when signal is not aborted', async () => {
  const result = await withAbort(Promise.resolve('ok'));
  assert.strictEqual(result, 'ok');
});

void it('withAbort rejects when signal is already aborted', async () => {
  const controller = new AbortController();
  controller.abort(new Error('already aborted'));

  await assert.rejects(
    async () => withAbort(Promise.resolve('ok'), controller.signal),
    /already aborted/
  );
});

void it('withAbort rejects when signal aborts after wrapping', async () => {
  const controller = new AbortController();
  const pending = new Promise<void>(() => {});
  const wrapped = withAbort(pending, controller.signal);

  controller.abort(new Error('aborted later'));

  await assert.rejects(async () => wrapped, /aborted later/);
});

void it('withAbort normalizes non-Error abort reasons to AbortError', async () => {
  const controller = new AbortController();
  const pending = new Promise<void>(() => {});
  const wrapped = withAbort(pending, controller.signal);

  controller.abort('stop-now');

  await assert.rejects(
    async () => wrapped,
    (error: unknown) => {
      return error instanceof Error && error.name === 'AbortError';
    }
  );
});

void it('assertNotAborted normalizes non-Error abort reasons', () => {
  const controller = new AbortController();
  controller.abort({ reason: 'custom' });

  assert.throws(
    () => {
      assertNotAborted(controller.signal);
    },
    (error: unknown) => {
      return error instanceof Error && error.name === 'AbortError';
    }
  );
});
