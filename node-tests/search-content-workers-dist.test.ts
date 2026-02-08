import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { type ChildProcessWithoutNullStreams } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

async function writeFixtureFiles(dir: string): Promise<void> {
  await fs.writeFile(
    path.join(dir, 'a.txt'),
    'hello needle world\nneedle on second line\n',
    'utf-8'
  );
  await fs.writeFile(path.join(dir, 'b.txt'), 'no match here\n', 'utf-8');
  await fs.mkdir(path.join(dir, 'sub'), { recursive: true });
  await fs.writeFile(path.join(dir, 'sub', 'c.txt'), 'needle again\n', 'utf-8');
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '..');

const testScript = `
(async () => {
  const testDir = process.env.FS_CONTEXT_TEST_DIR;
  if (!testDir) {
    process.stdout.write(
      JSON.stringify({ ok: false, error: 'Missing testDir argument' }) + '\\n'
    );
    process.exit(2);
    return;
  }

  const { setAllowedDirectoriesResolved } = await import(
    './dist/lib/path-validation.js'
  );
  const { searchContent } = await import(
    './dist/lib/file-operations/search-content.js'
  );

  await setAllowedDirectoriesResolved([testDir]);

  try {
    const result = await searchContent(testDir, 'needle', {
      timeoutMs: 10000,
      maxResults: 50,
    });
    process.stdout.write(
      JSON.stringify({ ok: true, matches: result.matches.length }) + '\\n'
    );
    process.exit(0);
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }) + '\\n'
    );
    process.exit(1);
  }
})();
`;

function spawnSearchProcess(
  testDir: string,
  signal?: AbortSignal
): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, ['--eval', testScript], {
    cwd: projectRoot,
    env: {
      ...process.env,
      FS_CONTEXT_SEARCH_WORKERS: '2',
      FS_CONTEXT_SEARCH_WORKERS_DEBUG: '1',
      FS_CONTEXT_TEST_DIR: testDir,
    },
    ...(signal ? { signal } : {}),
  });
}

async function runSearchInChild(testDir: string): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
}> {
  const timeoutSignal = AbortSignal.timeout(15_000);
  const child = spawnSearchProcess(testDir, timeoutSignal);

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf-8');
  child.stderr.setEncoding('utf-8');

  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  return await new Promise((resolve, reject) => {
    child.on('error', (err) => {
      if (timeoutSignal.aborted) {
        reject(new Error('Timed out waiting for dist worker search process'));
        return;
      }
      reject(err);
    });

    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

test('dist searchContent uses worker pool when enabled', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-context-mcp-'));
  try {
    await writeFixtureFiles(tmp);

    const { stdout, stderr, exitCode } = await runSearchInChild(tmp);
    assert.strictEqual(exitCode, 0, `child failed: ${stderr}\n${stdout}`);

    const parsed = JSON.parse(stdout.trim()) as
      | { ok: true; matches: number }
      | { ok: false; error: string };
    assert.ok(parsed.ok, parsed.ok ? undefined : parsed.error);
    assert.ok(
      parsed.ok && parsed.matches >= 2,
      `expected matches from fixture; got matches=${String(
        parsed.ok ? parsed.matches : 'n/a'
      )}\nstdout: ${stdout}\nstderr: ${stderr}`
    );
    assert.ok(
      stderr.includes('[SearchWorker] Started'),
      'expected workers to start (worker path exercised)'
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
