export function createAbortError(message = 'Operation aborted'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function assertNotAborted(signal?: AbortSignal, message?: string): void {
  if (!signal?.aborted) return;
  const { reason } = signal as { reason?: unknown };
  if (reason instanceof Error) {
    throw reason;
  }
  throw createAbortError(message);
}
