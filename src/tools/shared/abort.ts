function createTimeoutError(): Error {
  const error = new Error('Operation timed out');
  error.name = 'AbortError';
  return error;
}

function abortController(controller: AbortController, reason?: Error): void {
  if (!controller.signal.aborted) {
    controller.abort(reason);
  }
}

function attachBaseSignal(
  controller: AbortController,
  baseSignal?: AbortSignal
): () => void {
  if (!baseSignal) return () => {};
  if (baseSignal.aborted) {
    controller.abort(baseSignal.reason);
    return () => {};
  }

  const onAbort = (): void => {
    const reason =
      baseSignal.reason instanceof Error ? baseSignal.reason : undefined;
    abortController(controller, reason);
  };
  baseSignal.addEventListener('abort', onAbort, { once: true });
  return (): void => {
    baseSignal.removeEventListener('abort', onAbort);
  };
}

export function createTimedAbortSignal(
  baseSignal: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const detachBaseSignal = attachBaseSignal(controller, baseSignal);
  const timeoutId = setTimeout(() => {
    abortController(controller, createTimeoutError());
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      detachBaseSignal();
      clearTimeout(timeoutId);
    },
  };
}
