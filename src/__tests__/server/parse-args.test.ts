import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';

import { CliExitError, parseArgs } from '../../cli.js';
import { normalizePath } from '../../lib/path-validation.js';

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

await it('parseArgs supports --allow_cwd alias', async () => {
  const result = await withArgv(['--allow_cwd'], () => parseArgs());
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

await it('parseArgs de-duplicates repeated allowed directories', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-args-'));
  try {
    const result = await withArgv([tempDir, tempDir], () => parseArgs());
    assert.deepStrictEqual(result.allowedDirs, [normalizePath(tempDir)]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

await it('parseArgs de-duplicates Windows paths case-insensitively', async () => {
  if (os.platform() !== 'win32') return;

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-args-'));
  try {
    const result = await withArgv([tempDir, tempDir.toUpperCase()], () =>
      parseArgs()
    );
    assert.deepStrictEqual(result.allowedDirs, [normalizePath(tempDir)]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

await it('parseArgs rejects Windows drive-relative paths', async () => {
  if (os.platform() !== 'win32') return;
  await assert.rejects(
    withArgv(['C:relative'], () => parseArgs()),
    /drive-relative/i
  );
});

await it('parseArgs rejects Windows reserved device names', async () => {
  if (os.platform() !== 'win32') return;
  await assert.rejects(
    withArgv(['CON'], () => parseArgs()),
    /reserved/i
  );
});

await it('parseArgs handles --help as a clean CLI exit', async () => {
  await assert.rejects(
    withArgv(['--help'], () => parseArgs()),
    (error: unknown): boolean => {
      assert.ok(error instanceof CliExitError);
      assert.strictEqual(error.exitCode, 0);
      assert.match(error.message, /Usage:/);
      return true;
    }
  );
});

await it('parseArgs handles --version as a clean CLI exit', async () => {
  await assert.rejects(
    withArgv(['--version'], () => parseArgs()),
    (error: unknown): boolean => {
      assert.ok(error instanceof CliExitError);
      assert.strictEqual(error.exitCode, 0);
      assert.match(error.message, /\d+\.\d+\.\d+/);
      return true;
    }
  );
});

await it('parseArgs rejects unknown options with CLI exit code', async () => {
  await assert.rejects(
    withArgv(['--does-not-exist'], () => parseArgs()),
    (error: unknown): boolean => {
      assert.ok(error instanceof CliExitError);
      assert.ok(error.exitCode > 0);
      assert.match(error.message, /unknown option/i);
      return true;
    }
  );
});

await it('parseArgs returns clean CLI exit for missing directories', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-args-missing-'));
  const missingDir = path.join(tempDir, 'missing');

  try {
    await assert.rejects(
      withArgv([missingDir], () => parseArgs()),
      (error: unknown): boolean => {
        assert.ok(error instanceof CliExitError);
        assert.strictEqual(error.exitCode, 1);
        assert.match(error.message, /cannot access directory/i);
        return true;
      }
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

await it('parseArgs returns clean CLI exit for file paths', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-args-file-'));
  const tempFile = path.join(tempDir, 'file.txt');

  try {
    await fs.writeFile(tempFile, 'hello');
    await assert.rejects(
      withArgv([tempFile], () => parseArgs()),
      (error: unknown): boolean => {
        assert.ok(error instanceof CliExitError);
        assert.strictEqual(error.exitCode, 1);
        assert.match(error.message, /not a directory/i);
        return true;
      }
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
