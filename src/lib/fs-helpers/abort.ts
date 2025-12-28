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

export function getAbortError(signal: AbortSignal, message?: string): Error {
  const { reason } = signal as { reason?: unknown };
  if (reason instanceof Error) {
    return reason;
  }
  return createAbortError(message);
}

export function withAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    throw getAbortError(signal);
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(getAbortError(signal));
    };

    signal.addEventListener('abort', onAbort, { once: true });

    promise
      .then((value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      })
      .catch((error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });
}
