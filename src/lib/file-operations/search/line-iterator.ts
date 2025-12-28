import type { ReadStream } from 'node:fs';

interface LineBufferState {
  buffer: string;
  overflow: boolean;
}

function createBufferState(): LineBufferState {
  return { buffer: '', overflow: false };
}

function attachAbortHandler(
  stream: ReadStream,
  signal?: AbortSignal
): () => void {
  if (!signal) return () => {};

  const onAbort = (): void => {
    stream.destroy();
  };

  if (signal.aborted) {
    onAbort();
  } else {
    signal.addEventListener('abort', onAbort, { once: true });
  }

  return (): void => {
    signal.removeEventListener('abort', onAbort);
  };
}

function appendSegment(
  state: LineBufferState,
  segment: string,
  maxLineLength: number
): void {
  if (state.overflow) return;

  const available = maxLineLength - state.buffer.length;
  if (available <= 0) {
    state.overflow = true;
    return;
  }

  if (segment.length > available) {
    state.buffer += segment.slice(0, available);
    state.overflow = true;
    return;
  }

  state.buffer += segment;
}

function* processChunk(
  text: string,
  state: LineBufferState,
  maxLineLength: number
): Generator<string> {
  let cursor = 0;
  while (cursor < text.length) {
    const newlineIndex = text.indexOf('\n', cursor);
    const segmentEnd = newlineIndex === -1 ? text.length : newlineIndex;
    const segment = text.slice(cursor, segmentEnd);

    appendSegment(state, segment, maxLineLength);

    if (newlineIndex === -1) {
      cursor = segmentEnd;
      continue;
    }

    yield state.buffer.replace(/\r$/, '');
    state.buffer = '';
    state.overflow = false;
    cursor = newlineIndex + 1;
  }
}

function toChunkText(chunk: string | Buffer): string {
  return typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
}

function shouldFlushBuffer(
  state: LineBufferState,
  signal?: AbortSignal
): boolean {
  if (signal?.aborted) return false;
  return state.buffer.length > 0;
}

async function* iterateChunkLines(
  iterableStream: AsyncIterable<string | Buffer>,
  state: LineBufferState,
  maxLineLength: number,
  signal?: AbortSignal
): AsyncGenerator<string> {
  for await (const chunk of iterableStream) {
    if (signal?.aborted) return;
    yield* processChunk(toChunkText(chunk), state, maxLineLength);
  }
}

function flushBuffer(
  state: LineBufferState,
  signal?: AbortSignal
): string | undefined {
  if (!shouldFlushBuffer(state, signal)) return undefined;
  return state.buffer.replace(/\r$/, '');
}

export async function* iterateLines(
  stream: ReadStream,
  maxLineLength: number,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const state = createBufferState();
  const detachAbort = attachAbortHandler(stream, signal);
  const iterableStream = stream as AsyncIterable<string | Buffer>;

  try {
    yield* iterateChunkLines(iterableStream, state, maxLineLength, signal);
    const flushed = flushBuffer(state, signal);
    if (flushed !== undefined) yield flushed;
  } finally {
    detachAbort();
  }
}
