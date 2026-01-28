import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';

import { normalizePath } from '../../lib/path-validation.js';
import { parseArgs } from '../../server.js';

const originalArgv = process.argv.slice();

function withArgv<T>(args: string[], fn: () => Promise<T>): Promise<T> {
  process.argv = [
    originalArgv[0] ?? 'node',
    originalArgv[1] ?? 'script',
    ...args,
  ];
  return fn().finally(() => {
    process.argv = originalArgv.slice();
  });
}

afterEach(() => {
  process.argv = originalArgv.slice();
});

await it('parseArgs respects --allow-cwd', async () => {
  const result = await withArgv(['--allow-cwd'], () => parseArgs());
  assert.strictEqual(result.allowCwd, true);
  assert.deepStrictEqual(result.allowedDirs, []);
});

await it('parseArgs normalizes allowed directories', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-args-'));
  try {
    const result = await withArgv([tempDir], () => parseArgs());
    assert.deepStrictEqual(result.allowedDirs, [normalizePath(tempDir)]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

await it('parseArgs rejects Windows drive-relative paths', async () => {
  if (process.platform !== 'win32') return;
  await assert.rejects(
    withArgv(['C:relative'], () => parseArgs()),
    /drive-relative/i
  );
});

await it('parseArgs rejects Windows reserved device names', async () => {
  if (process.platform !== 'win32') return;
  await assert.rejects(
    withArgv(['CON'], () => parseArgs()),
    /reserved/i
  );
});
