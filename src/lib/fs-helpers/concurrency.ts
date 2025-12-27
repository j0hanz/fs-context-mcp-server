import { PARALLEL_CONCURRENCY } from '../constants.js';

interface ParallelResult<R> {
  results: R[];
  errors: { index: number; error: Error }[];
}

interface WorkQueueState<T> {
  queue: T[];
  inFlight: number;
  aborted: boolean;
  errors: Error[];
  abortReason?: Error;
  doneResolve?: () => void;
}

function createDonePromise(state: WorkQueueState<unknown>): Promise<void> {
  return new Promise<void>((resolve) => {
    state.doneResolve = resolve;
  });
}

function resolveIfDone<T>(state: WorkQueueState<T>): void {
  if (state.inFlight !== 0) return;
  if (state.queue.length === 0 || state.aborted) {
    state.doneResolve?.();
  }
}

function createAbortError(): Error {
  const error = new Error('Operation aborted');
  error.name = 'AbortError';
  return error;
}

function recordError<T>(state: WorkQueueState<T>, error: unknown): void {
  const normalized = error instanceof Error ? error : new Error(String(error));
  state.errors.push(normalized);
  if (!state.aborted) {
    state.aborted = true;
    state.abortReason = normalized;
  }
  resolveIfDone(state);
}

function createAbortHandler<T>(state: WorkQueueState<T>): () => void {
  return (): void => {
    if (!state.aborted) {
      state.aborted = true;
      state.abortReason = createAbortError();
    }
    resolveIfDone(state);
  };
}

function enqueueItem<T>(state: WorkQueueState<T>, item: T): void {
  if (state.aborted) return;
  state.queue.push(item);
}

function handleWorkerCompletion<T>(state: WorkQueueState<T>): void {
  state.inFlight--;
  resolveIfDone(state);
}

function startWorker<T>(
  state: WorkQueueState<T>,
  item: T,
  worker: (item: T, enqueue: (item: T) => void) => Promise<void>,
  maybeStartNext: () => void
): void {
  state.inFlight++;

  try {
    void worker(item, (next) => {
      enqueueItem(state, next);
      maybeStartNext();
    })
      .catch((error: unknown) => {
        console.error(
          '[runWorkQueue] Worker error:',
          error instanceof Error ? error.message : String(error)
        );
        recordError(state, error);
      })
      .finally(() => {
        handleWorkerCompletion(state);
        if (!state.aborted) {
          maybeStartNext();
        }
      });
  } catch (error) {
    console.error(
      '[runWorkQueue] Worker synchronous error:',
      error instanceof Error ? error.message : String(error)
    );
    recordError(state, error);
    handleWorkerCompletion(state);
    if (!state.aborted) {
      maybeStartNext();
    }
  }
}

function createQueueProcessor<T>(
  state: WorkQueueState<T>,
  worker: (item: T, enqueue: (item: T) => void) => Promise<void>,
  concurrency: number
): () => void {
  const maybeStartNext = (): void => {
    if (state.aborted) return;

    while (state.inFlight < concurrency && state.queue.length > 0) {
      const next = state.queue.shift();
      if (next === undefined) break;
      startWorker(state, next, worker, maybeStartNext);
    }
  };

  return maybeStartNext;
}

export async function runWorkQueue<T>(
  initialItems: T[],
  worker: (item: T, enqueue: (item: T) => void) => Promise<void>,
  concurrency: number,
  signal?: AbortSignal
): Promise<void> {
  const state: WorkQueueState<T> = {
    queue: [...initialItems],
    inFlight: 0,
    aborted: false,
    errors: [],
  };
  const donePromise = createDonePromise(state);
  const onAbort = createAbortHandler(state);

  if (signal?.aborted) {
    state.aborted = true;
    state.abortReason = createAbortError();
  }

  signal?.addEventListener('abort', onAbort, { once: true });

  const maybeStartNext = createQueueProcessor(state, worker, concurrency);
  maybeStartNext();
  resolveIfDone(state);

  try {
    await donePromise;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }

  if (state.errors.length === 1) {
    const error = state.errors[0];
    throw error ?? new Error('Work queue failed');
  }
  if (state.errors.length > 1) {
    throw new AggregateError(state.errors, 'Work queue failed');
  }
  if (state.abortReason) {
    throw state.abortReason;
  }
}

export async function processInParallel<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency: number = PARALLEL_CONCURRENCY,
  signal?: AbortSignal
): Promise<ParallelResult<R>> {
  const results: R[] = [];
  const errors: { index: number; error: Error }[] = [];

  if (items.length === 0) {
    return { results, errors };
  }

  await runWorkQueue(
    items.map((item, index) => ({ item, index })),
    async ({ item, index }) => {
      try {
        const result = await processor(item);
        results.push(result);
      } catch (reason) {
        const error =
          reason instanceof Error ? reason : new Error(String(reason));
        errors.push({ index, error });
      }
    },
    concurrency,
    signal
  );

  return { results, errors };
}
