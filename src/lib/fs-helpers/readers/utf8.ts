import type { FileHandle } from 'node:fs/promises';

export async function findUTF8Boundary(
  handle: FileHandle,
  position: number
): Promise<number> {
  if (position <= 0) return 0;

  const backtrackSize = Math.min(4, position);
  const startPos = position - backtrackSize;
  const buf = Buffer.allocUnsafe(backtrackSize);

  try {
    const { bytesRead } = await handle.read(buf, 0, backtrackSize, startPos);

    for (let i = bytesRead - 1; i >= 0; i--) {
      const byte = buf[i];
      if (byte !== undefined && (byte & 0xc0) !== 0x80) {
        return startPos + i;
      }
    }
  } catch (error) {
    console.error(
      `[findUTF8Boundary] Read error at position ${position}:`,
      error instanceof Error ? error.message : String(error)
    );
    return position;
  }

  return position;
}
