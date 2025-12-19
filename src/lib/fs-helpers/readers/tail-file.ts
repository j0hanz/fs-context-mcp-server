import * as fs from 'node:fs/promises';

import { validateExistingPath } from '../../path-validation.js';
import { findUTF8Boundary } from './utf8.js';

interface TailReadState {
  position: number;
  bytesReadTotal: number;
  remainingText: string;
  linesFound: number;
  lines: string[];
}

interface TailReadWindow {
  startPos: number;
  size: number;
}

const CHUNK_SIZE = 256 * 1024;

function initTailState(fileSize: number): TailReadState {
  return {
    position: fileSize,
    bytesReadTotal: 0,
    remainingText: '',
    linesFound: 0,
    lines: [],
  };
}

function shouldContinue(state: TailReadState, numLines: number): boolean {
  return state.position > 0 && state.linesFound < numLines;
}

function clampWindow(
  position: number,
  maxBytesRead: number | undefined,
  bytesReadTotal: number
): TailReadWindow | null {
  if (position <= 0) return null;

  let size = Math.min(CHUNK_SIZE, position);
  let startPos = position - size;

  if (maxBytesRead !== undefined) {
    const remainingBytes = maxBytesRead - bytesReadTotal;
    if (remainingBytes <= 0) return null;
    if (size > remainingBytes) {
      size = remainingBytes;
      startPos = position - size;
    }
  }

  return { startPos, size };
}

async function alignWindow(
  handle: fs.FileHandle,
  window: TailReadWindow,
  position: number,
  maxBytesRead: number | undefined,
  bytesReadTotal: number
): Promise<TailReadWindow> {
  if (window.startPos <= 0) return window;

  const alignedPos = await findUTF8Boundary(handle, window.startPos);
  const alignedSize = position - alignedPos;

  if (
    maxBytesRead === undefined ||
    alignedSize <= maxBytesRead - bytesReadTotal
  ) {
    return { startPos: alignedPos, size: alignedSize };
  }

  return window;
}

function applyChunkLines(
  state: TailReadState,
  chunkText: string,
  numLines: number,
  hasMoreBefore: boolean
): void {
  const chunkLines = chunkText.replace(/\r\n/g, '\n').split('\n');
  if (hasMoreBefore) {
    state.remainingText = chunkLines.shift() ?? '';
  } else {
    state.remainingText = '';
  }

  for (let i = chunkLines.length - 1; i >= 0; i--) {
    if (state.linesFound >= numLines) break;
    const line = chunkLines[i];
    if (line !== undefined) {
      state.lines.unshift(line);
      state.linesFound++;
    }
  }
}

async function readTailChunk(
  handle: fs.FileHandle,
  state: TailReadState,
  numLines: number,
  encoding: BufferEncoding,
  maxBytesRead: number | undefined
): Promise<void> {
  const window = clampWindow(
    state.position,
    maxBytesRead,
    state.bytesReadTotal
  );
  if (!window) {
    state.position = 0;
    return;
  }

  const aligned = await alignWindow(
    handle,
    window,
    state.position,
    maxBytesRead,
    state.bytesReadTotal
  );

  state.position = aligned.startPos;
  const chunk = Buffer.alloc(aligned.size + 4);
  const { bytesRead } = await handle.read(
    chunk,
    0,
    aligned.size,
    aligned.startPos
  );
  if (bytesRead === 0) {
    state.position = 0;
    return;
  }

  state.bytesReadTotal += bytesRead;
  const readData = chunk.subarray(0, bytesRead).toString(encoding);
  const combined = readData + state.remainingText;
  applyChunkLines(state, combined, numLines, state.position > 0);
}

export async function tailFile(
  filePath: string,
  numLines: number,
  encoding: BufferEncoding = 'utf-8',
  maxBytesRead?: number
): Promise<string> {
  const validPath = await validateExistingPath(filePath);
  const stats = await fs.stat(validPath);
  if (stats.size === 0) return '';

  const handle = await fs.open(validPath, 'r');
  try {
    const state = initTailState(stats.size);

    while (shouldContinue(state, numLines)) {
      await readTailChunk(handle, state, numLines, encoding, maxBytesRead);
    }

    return state.lines.join('\n');
  } finally {
    await handle.close().catch(() => {});
  }
}
