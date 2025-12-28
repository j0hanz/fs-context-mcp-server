import { createReadStream } from 'node:fs';
import type { ReadStream } from 'node:fs';

import { ErrorCode, McpError } from '../../errors.js';
import { createAbortError } from '../abort.js';

const STREAM_CHUNK_SIZE = 64 * 1024;

function createTooLargeError(
  bytesRead: number,
  maxSize: number,
  requestedPath: string
): McpError {
  return new McpError(
    ErrorCode.E_TOO_LARGE,
    `File exceeds maximum size (${bytesRead} > ${maxSize}): ${requestedPath}`,
    requestedPath,
    { size: bytesRead, maxSize }
  );
}

function attachAbortHandler(
  stream: ReadStream,
  signal?: AbortSignal
): () => void {
  if (!signal) return () => {};

  const onAbort = (): void => {
    stream.destroy(createAbortError());
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

async function collectChunks(
  iterableStream: AsyncIterable<Buffer>,
  maxSize: number,
  requestedPath: string,
  chunks: Buffer[]
): Promise<number> {
  let totalSize = 0;
  for await (const chunk of iterableStream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalSize += buffer.length;
    if (totalSize > maxSize) {
      throw createTooLargeError(totalSize, maxSize, requestedPath);
    }
    chunks.push(buffer);
  }
  return totalSize;
}

export async function readFileBufferWithLimit(
  filePath: string,
  maxSize: number,
  requestedPath: string = filePath,
  signal?: AbortSignal
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const stream: ReadStream = createReadStream(filePath, {
    highWaterMark: STREAM_CHUNK_SIZE,
  });
  const detachAbort = attachAbortHandler(stream, signal);
  const iterableStream = stream as AsyncIterable<Buffer>;

  try {
    const totalSize = await collectChunks(
      iterableStream,
      maxSize,
      requestedPath,
      chunks
    );
    return Buffer.concat(chunks, totalSize);
  } finally {
    detachAbort();
    stream.destroy();
  }
}
