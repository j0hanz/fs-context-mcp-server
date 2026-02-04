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
import { registerSearchFilesTool } from '../../tools/search-files.js';
import { createSingleToolCapture } from '../shared/diagnostics-env.js';

const createdDirs: string[] = [];
const createdLinks: string[] = [];
const originalAllowed = getAllowedDirectories();

async function createTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

async function cleanup(): Promise<void> {
  for (const link of createdLinks.splice(0)) {
    await fs.rm(link, { force: true }).catch(() => {});
  }
  for (const dir of createdDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

afterEach(async () => {
  await setAllowedDirectoriesResolved(originalAllowed);
  await cleanup();
});

await it('find skips symlink escapes outside allowed roots', async () => {
  const root = await createTempDir('mcp-root-');
  const outside = await createTempDir('mcp-outside-');
  const outsideFile = path.join(outside, 'secret.txt');
  await fs.writeFile(outsideFile, 'secret');

  const linkPath = path.join(root, 'link');
  try {
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    await fs.symlink(outside, linkPath, linkType);
  } catch {
    // Symlink creation can be restricted on some platforms; skip coverage.
    return;
  }
  createdLinks.push(linkPath);

  await setAllowedDirectoriesResolved([root]);

  const { fakeServer, getHandler } = createSingleToolCapture();
  registerSearchFilesTool(fakeServer);
  const handler = getHandler();

  const result = (await handler(
    { path: root, pattern: '**/*.txt', includeIgnored: true },
    {}
  )) as {
    structuredContent?: {
      results?: { path?: string }[];
      error?: { code?: string };
    };
  };

  const results = result.structuredContent?.results ?? [];
  assert.deepStrictEqual(results, []);
  assert.notStrictEqual(
    result.structuredContent?.error?.code,
    ErrorCode.E_ACCESS_DENIED
  );
});
