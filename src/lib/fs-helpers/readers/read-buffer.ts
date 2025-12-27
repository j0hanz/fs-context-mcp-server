import { createReadStream } from 'node:fs';

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

export async function readFileBufferWithLimit(
  filePath: string,
  maxSize: number,
  requestedPath: string = filePath,
  signal?: AbortSignal
): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    let settled = false;

    const stream = createReadStream(filePath, {
      highWaterMark: STREAM_CHUNK_SIZE,
    });

    const cleanup = (): void => {
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      stream.destroy();
      reject(error);
    };

    const onAbort = (): void => {
      fail(createAbortError());
    };

    const onData = (chunk: Buffer | string): void => {
      const chunkSize =
        typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
      totalSize += chunkSize;
      if (totalSize > maxSize) {
        fail(createTooLargeError(totalSize, maxSize, requestedPath));
        return;
      }
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    };

    const onEnd = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks, totalSize));
    };

    const onError = (error: unknown): void => {
      fail(error instanceof Error ? error : new Error(String(error)));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
  });
}
