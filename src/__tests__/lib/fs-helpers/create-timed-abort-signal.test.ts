import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createTimedAbortSignal } from '../../../lib/fs-helpers.js';

describe('createTimedAbortSignal', () => {
  describe('no signal, no timeout', () => {
    it('returns a non-aborted signal with noop cleanup', () => {
      const { signal, cleanup } = createTimedAbortSignal(undefined, undefined);
      assert.equal(signal.aborted, false);
      cleanup(); // Should not throw
    });
  });

  describe('baseSignal only (no timeout)', () => {
    it('forwards the baseSignal directly', () => {
      const controller = new AbortController();
      const { signal, cleanup } = createTimedAbortSignal(
        controller.signal,
        undefined
      );

      assert.equal(signal, controller.signal, 'Should return same signal');
      assert.equal(signal.aborted, false);

      controller.abort();
      assert.equal(signal.aborted, true);
      cleanup();
    });

    it('forwards already-aborted baseSignal', () => {
      const controller = new AbortController();
      controller.abort();

      const { signal, cleanup } = createTimedAbortSignal(
        controller.signal,
        undefined
      );

      assert.equal(signal, controller.signal);
      assert.equal(signal.aborted, true);
      cleanup();
    });
  });

  describe('timeout only (no baseSignal)', () => {
    it('aborts after timeout expires', async () => {
      const { signal, cleanup } = createTimedAbortSignal(undefined, 50);

      assert.equal(signal.aborted, false);

      // Wait for timeout to fire
      await new Promise((resolve) => {
        signal.addEventListener('abort', resolve);
      });

      assert.equal(signal.aborted, true);
      assert.match(
        signal.reason?.message ?? '',
        /timed out/i,
        'Reason should mention timeout'
      );

      cleanup();
    });

    it('prevents abort if cleanup called before timeout', async () => {
      const { signal, cleanup } = createTimedAbortSignal(undefined, 100);

      assert.equal(signal.aborted, false);

      // Cleanup immediately
      cleanup();

      // Wait longer than timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      assert.equal(signal.aborted, false, 'Should not abort after cleanup');
    });

    it('handles invalid timeout gracefully', () => {
      const { signal, cleanup } = createTimedAbortSignal(undefined, NaN);
      assert.equal(signal.aborted, false);
      cleanup();
    });

    it('handles infinite timeout gracefully', () => {
      const { signal, cleanup } = createTimedAbortSignal(undefined, Infinity);
      assert.equal(signal.aborted, false);
      cleanup();
    });
  });

  describe('combined: baseSignal + timeout', () => {
    it('aborts when timeout fires first', async () => {
      const controller = new AbortController();
      const { signal, cleanup } = createTimedAbortSignal(controller.signal, 50);

      assert.equal(signal.aborted, false);

      // Wait for timeout
      await new Promise((resolve) => {
        signal.addEventListener('abort', resolve);
      });

      assert.equal(signal.aborted, true);
      assert.match(signal.reason?.message ?? '', /timed out/i);

      cleanup();
    });

    it('aborts when baseSignal fires first', async () => {
      const controller = new AbortController();
      const { signal, cleanup } = createTimedAbortSignal(
        controller.signal,
        200
      );

      assert.equal(signal.aborted, false);

      // Abort base signal immediately
      controller.abort(new Error('Base aborted'));

      // Signal should abort immediately
      assert.equal(signal.aborted, true);
      assert.match(signal.reason?.message ?? '', /Base aborted/);

      cleanup();
    });

    it('forwards baseSignal reason when baseSignal aborts first', async () => {
      const controller = new AbortController();
      const customReason = new Error('Custom abort reason');

      const { signal, cleanup } = createTimedAbortSignal(
        controller.signal,
        200
      );

      controller.abort(customReason);

      assert.equal(signal.aborted, true);
      assert.equal(signal.reason, customReason);

      cleanup();
    });

    it('cleanup prevents both timeout and baseSignal from aborting', async () => {
      const controller = new AbortController();
      const { signal, cleanup } = createTimedAbortSignal(
        controller.signal,
        100
      );

      assert.equal(signal.aborted, false);

      // Clean up immediately
      cleanup();

      // Try to abort baseSignal
      controller.abort();

      // Wait longer than timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      assert.equal(
        signal.aborted,
        false,
        'Signal should not abort after cleanup'
      );
    });

    it('handles already-aborted baseSignal with timeout', () => {
      const controller = new AbortController();
      const customError = new Error('Already aborted');
      controller.abort(customError);

      const { signal, cleanup } = createTimedAbortSignal(
        controller.signal,
        100
      );

      assert.equal(signal.aborted, true);
      assert.equal(signal.reason, customError);

      cleanup();
    });
  });

  describe('cleanup safety', () => {
    it('cleanup is idempotent', () => {
      const { cleanup } = createTimedAbortSignal(undefined, 100);

      cleanup();
      cleanup(); // Should not throw
      cleanup(); // Should not throw
    });

    it('cleanup removes event listener from baseSignal', async () => {
      const controller = new AbortController();
      const { signal, cleanup } = createTimedAbortSignal(
        controller.signal,
        100
      );

      cleanup();

      // After cleanup, aborting base should not affect our signal
      controller.abort();

      assert.equal(signal.aborted, false);
    });
  });

  describe('edge cases', () => {
    it('handles very large timeout', () => {
      const { signal, cleanup } = createTimedAbortSignal(undefined, 2147483647);

      assert.equal(signal.aborted, false);
      cleanup();
    });

    it('preserves signal reason type', async () => {
      const controller = new AbortController();
      const customObject = { code: 'CUSTOM_ABORT', detail: 'test' };

      const { signal, cleanup } = createTimedAbortSignal(
        controller.signal,
        200
      );

      controller.abort(customObject);

      assert.equal(signal.aborted, true);
      assert.equal(signal.reason, customObject);

      cleanup();
    });
  });
});
