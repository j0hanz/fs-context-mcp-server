import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { it } from 'node:test';

import {
  getAllowedDirectories,
  setAllowedDirectoriesResolved,
} from '../../lib/path-validation.js';
import { registerCreateDirectoryTool } from '../../tools/create-directory.js';
import { registerDeleteFileTool } from '../../tools/delete-file.js';
import { registerEditFileTool } from '../../tools/edit-file.js';
import { registerMoveFileTool } from '../../tools/move-file.js';
import { registerWriteFileTool } from '../../tools/write-file.js';
import { createSingleToolCapture } from '../shared/diagnostics-env.js';

await it('write operations integration test', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-mcp-write-test-'));
  const previousAllowed = getAllowedDirectories();
  await setAllowedDirectoriesResolved([tmpDir]);

  try {
    // 1. Create Directory
    {
      const { fakeServer, getHandler } = createSingleToolCapture();
      registerCreateDirectoryTool(fakeServer);
      const handler = getHandler();
      const result = (await handler(
        { path: path.join(tmpDir, 'new-dir') },
        {}
      )) as any;
      assert.equal(result.isError, undefined);
      const stats = await fs.stat(path.join(tmpDir, 'new-dir'));
      assert.ok(stats.isDirectory());
    }

    // 2. Write File
    {
      const { fakeServer, getHandler } = createSingleToolCapture();
      registerWriteFileTool(fakeServer);
      const handler = getHandler();
      const filePath = path.join(tmpDir, 'test.txt');
      const result = (await handler(
        { path: filePath, content: 'Hello World' },
        {}
      )) as any;
      assert.equal(result.isError, undefined);
      const content = await fs.readFile(filePath, 'utf-8');
      assert.strictEqual(content, 'Hello World');
    }

    // 3. Edit File
    {
      const { fakeServer, getHandler } = createSingleToolCapture();
      registerEditFileTool(fakeServer);
      const handler = getHandler();
      const filePath = path.join(tmpDir, 'test.txt');
      const result = (await handler(
        {
          path: filePath,
          edits: [{ oldText: 'World', newText: 'MCP' }],
        },
        {}
      )) as any;
      assert.equal(result.isError, undefined);
      const content = await fs.readFile(filePath, 'utf-8');
      assert.strictEqual(content, 'Hello MCP');
    }

    // 3b. Edit File (unmatched)
    {
      const { fakeServer, getHandler } = createSingleToolCapture();
      registerEditFileTool(fakeServer);
      const handler = getHandler();
      const filePath = path.join(tmpDir, 'test.txt');
      const result = (await handler(
        {
          path: filePath,
          edits: [{ oldText: 'Missing', newText: 'Nope' }],
        },
        {}
      )) as any;
      assert.equal(result.isError, undefined);
      assert.deepStrictEqual(result.structuredContent.unmatchedEdits, [
        'Missing',
      ]);
      const content = await fs.readFile(filePath, 'utf-8');
      assert.strictEqual(content, 'Hello MCP');
    }

    // 4. Move File
    {
      const { fakeServer, getHandler } = createSingleToolCapture();
      registerMoveFileTool(fakeServer);
      const handler = getHandler();
      const src = path.join(tmpDir, 'test.txt');
      const dest = path.join(tmpDir, 'moved.txt');
      const result = (await handler(
        { source: src, destination: dest },
        {}
      )) as any;
      assert.equal(result.isError, undefined);
      await assert.rejects(() => fs.stat(src));
      const content = await fs.readFile(dest, 'utf-8');
      assert.strictEqual(content, 'Hello MCP');
    }

    // 5. Delete File
    {
      const { fakeServer, getHandler } = createSingleToolCapture();
      registerDeleteFileTool(fakeServer);
      const handler = getHandler();
      const target = path.join(tmpDir, 'moved.txt');
      const result = (await handler(
        { path: target, recursive: false, ignoreIfNotExists: false },
        {}
      )) as any;
      if (result.isError) {
        console.error('Delete failed:', JSON.stringify(result, null, 2));
      }
      assert.equal(result.isError, undefined);
      await assert.rejects(() => fs.stat(target));
    }
  } finally {
    await setAllowedDirectoriesResolved(previousAllowed);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
