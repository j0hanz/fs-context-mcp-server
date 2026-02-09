import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { it } from 'node:test';

import {
  getAllowedDirectories,
  setAllowedDirectoriesResolved,
} from '../../lib/path-validation.js';
import { registerApplyPatchTool } from '../../tools/apply-patch.js';
import { registerCalculateHashTool } from '../../tools/calculate-hash.js';
import { registerDiffFilesTool } from '../../tools/diff-files.js';
import { registerSearchAndReplaceTool } from '../../tools/replace-in-files.js';
import { createSingleToolCapture } from '../shared/diagnostics-env.js';

await it('advanced operations integration test', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-mcp-adv-test-'));
  const previousAllowed = getAllowedDirectories();
  await setAllowedDirectoriesResolved([tmpDir]);

  try {
    // 1. Calculate Hash
    {
      const filePath = path.join(tmpDir, 'hash.txt');
      await fs.writeFile(filePath, 'hello world', 'utf-8');
      const { fakeServer, getHandler } = createSingleToolCapture();
      registerCalculateHashTool(fakeServer);
      const handler = getHandler();
      const result = (await handler({ path: filePath }, {})) as any;
      assert.equal(result.isError, undefined);
      // SHA-256 of "hello world"
      assert.strictEqual(
        result.structuredContent.hash,
        'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
      );
    }

    // 2. Diff Files
    {
      const fileA = path.join(tmpDir, 'a.txt');
      const fileB = path.join(tmpDir, 'b.txt');
      await fs.writeFile(fileA, 'foo\nbar\n', 'utf-8');
      await fs.writeFile(fileB, 'foo\nbaz\n', 'utf-8');

      const { fakeServer, getHandler } = createSingleToolCapture();
      registerDiffFilesTool(fakeServer);
      const handler = getHandler();
      const result = (await handler(
        { original: fileA, modified: fileB },
        {}
      )) as any;
      assert.equal(result.isError, undefined);
      assert.ok(result.structuredContent.diff.includes('-bar'));
      assert.ok(result.structuredContent.diff.includes('+baz'));
    }

    // 3. Apply Patch
    {
      const fileC = path.join(tmpDir, 'c.txt');
      await fs.writeFile(fileC, 'foo\nbar\n', 'utf-8');

      const patch = `Index: c.txt
===================================================================
--- c.txt
+++ c.txt
@@ -1,2 +1,2 @@
 foo
-bar
+baz
`;
      const { fakeServer, getHandler } = createSingleToolCapture();
      registerApplyPatchTool(fakeServer);
      const handler = getHandler();
      const result = (await handler(
        { path: fileC, patch, fuzzy: false },
        {}
      )) as any;
      assert.equal(result.isError, undefined);

      const content = await fs.readFile(fileC, 'utf-8');
      assert.strictEqual(content, 'foo\nbaz\n');
    }

    // 4. Search and Replace
    {
      const subDir = path.join(tmpDir, 'src');
      await fs.mkdir(subDir);
      await fs.writeFile(path.join(subDir, 'f1.ts'), 'const x = 1;', 'utf-8');
      await fs.writeFile(path.join(subDir, 'f2.ts'), 'const y = 1;', 'utf-8');

      const { fakeServer, getHandler } = createSingleToolCapture();
      registerSearchAndReplaceTool(fakeServer);
      const handler = getHandler();

      // Dry Run
      const dryResult = (await handler(
        {
          path: tmpDir,
          filePattern: '**/*.ts',
          searchPattern: '1',
          replacement: '2',
          dryRun: true,
        },
        {}
      )) as any;

      assert.equal(dryResult.isError, undefined);
      assert.strictEqual(dryResult.structuredContent.filesChanged, 2);

      const contentCheck = await fs.readFile(
        path.join(subDir, 'f1.ts'),
        'utf-8'
      );
      assert.strictEqual(contentCheck, 'const x = 1;'); // Unchanged

      // Real Run
      const realResult = (await handler(
        {
          path: tmpDir,
          filePattern: '**/*.ts',
          searchPattern: '1',
          replacement: '2',
          dryRun: false,
        },
        {}
      )) as any;

      assert.equal(realResult.isError, undefined);
      assert.strictEqual(realResult.structuredContent.filesChanged, 2);

      const c1 = await fs.readFile(path.join(subDir, 'f1.ts'), 'utf-8');
      const c2 = await fs.readFile(path.join(subDir, 'f2.ts'), 'utf-8');
      assert.strictEqual(c1, 'const x = 2;');
      assert.strictEqual(c2, 'const y = 2;');
    }
  } finally {
    await setAllowedDirectoriesResolved(previousAllowed);
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  }
});
