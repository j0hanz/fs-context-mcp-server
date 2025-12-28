export type StreamStopReason = 'timeout' | 'abort' | null;

interface StreamAbortOptions {
  signal?: AbortSignal;
  deadlineMs?: number;
  destroyStream: () => void;
  onTimeout: () => void;
  onAbort: () => void;
}

interface StreamAbortController {
  getStopReason: () => StreamStopReason;
  cleanup: () => void;
}

interface StreamAbortState {
  stopReason: StreamStopReason;
  timeoutId?: ReturnType<typeof setTimeout>;
}

function clearTimer(state: StreamAbortState): void {
  if (!state.timeoutId) return;
  clearTimeout(state.timeoutId);
  state.timeoutId = undefined;
}

function setStopReason(
  state: StreamAbortState,
  reason: StreamStopReason,
  onTimeout: () => void,
  onAbort: () => void
): void {
  if (state.stopReason !== null || reason === null) return;
  state.stopReason = reason;
  if (reason === 'timeout') {
    onTimeout();
    return;
  }
  onAbort();
}

function resolveAbortReason(deadlineMs: number | undefined): StreamStopReason {
  if (deadlineMs === undefined) return 'abort';
  return Date.now() >= deadlineMs ? 'timeout' : 'abort';
}

function handleAbort(
  state: StreamAbortState,
  deadlineMs: number | undefined,
  destroyStream: () => void,
  onTimeout: () => void,
  onAbort: () => void
): void {
  setStopReason(state, resolveAbortReason(deadlineMs), onTimeout, onAbort);
  clearTimer(state);
  destroyStream();
}

function handleTimeout(
  state: StreamAbortState,
  destroyStream: () => void,
  onTimeout: () => void,
  onAbort: () => void
): void {
  if (state.stopReason === 'abort') return;
  setStopReason(state, 'timeout', onTimeout, onAbort);
  destroyStream();
}

export function createStreamAbortController(
  options: StreamAbortOptions
): StreamAbortController {
  const { signal, deadlineMs, destroyStream, onTimeout, onAbort } = options;
  const state: StreamAbortState = { stopReason: null };
  const onAbortSignal = (): void => {
    handleAbort(state, deadlineMs, destroyStream, onTimeout, onAbort);
  };

  if (signal?.aborted) {
    onAbortSignal();
  } else if (signal) {
    signal.addEventListener('abort', onAbortSignal, { once: true });
  }

  if (deadlineMs !== undefined) {
    const delay = Math.max(0, deadlineMs - Date.now());
    state.timeoutId = setTimeout(() => {
      handleTimeout(state, destroyStream, onTimeout, onAbort);
    }, delay);
  }

  return {
    getStopReason: () => state.stopReason,
    cleanup: (): void => {
      if (signal) signal.removeEventListener('abort', onAbortSignal);
      clearTimer(state);
    },
  };
}
