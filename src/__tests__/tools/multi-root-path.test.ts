import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';

import { ErrorCode } from '../../lib/errors.js';
import {
  getAllowedDirectories,
  setAllowedDirectoriesResolved,
} from '../../lib/path-validation.js';
import { registerListDirectoryTool } from '../../tools.js';
import { createSingleToolCapture } from '../shared/diagnostics-env.js';

const createdDirs: string[] = [];
const originalAllowed = getAllowedDirectories();

async function createTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await setAllowedDirectoriesResolved(originalAllowed);
  await Promise.all(
    createdDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

await it('ls requires explicit path when multiple roots are configured', async () => {
  const dir1 = await createTempDir('mcp-root-1-');
  const dir2 = await createTempDir('mcp-root-2-');
  await setAllowedDirectoriesResolved([dir1, dir2]);

  const { fakeServer, getHandler } = createSingleToolCapture();
  registerListDirectoryTool(fakeServer);
  const handler = getHandler();

  const result = (await handler({}, {})) as {
    isError?: boolean;
    structuredContent?: { ok?: boolean; error?: { code?: string } };
  };

  assert.strictEqual(result.isError, true);
  assert.ok(result.structuredContent);
  assert.strictEqual(result.structuredContent.ok, false);
  assert.ok(result.structuredContent.error);
  assert.strictEqual(
    result.structuredContent.error.code,
    ErrorCode.E_INVALID_INPUT
  );
});
