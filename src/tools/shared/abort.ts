export function createTimedAbortSignal(
  baseSignal: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const abort = (reason?: Error): void => {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  };

  const timeoutError = (): Error => {
    const error = new Error('Operation timed out');
    error.name = 'AbortError';
    return error;
  };

  let onAbort: (() => void) | undefined;
  if (baseSignal?.aborted) {
    controller.abort(baseSignal.reason);
  } else if (baseSignal) {
    onAbort = (): void => {
      const reason =
        baseSignal.reason instanceof Error ? baseSignal.reason : undefined;
      abort(reason);
    };
    baseSignal.addEventListener('abort', onAbort, { once: true });
  }

  timeoutId = setTimeout(() => {
    abort(timeoutError());
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      if (baseSignal && onAbort) {
        baseSignal.removeEventListener('abort', onAbort);
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    },
  };
}
