import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { listDirectory } from '../../../lib/file-operations/list-directory.js';
import { withFileOpsFixture } from '../fixtures/file-ops-hooks.js';

void describe('listDirectory edge cases', () => {
  withFileOpsFixture((getTestDir) => {
    void it('listDirectory is always shallow (maxDepth=1)', async () => {
      const result = await listDirectory(getTestDir());
      // list_directory is always shallow - maxDepthReached should be 1
      assert.strictEqual(result.summary.maxDepthReached, 1);
    });

    void it('listDirectory handles empty directory', async () => {
      const emptyDir = path.join(getTestDir(), 'empty-dir');
      await fs.mkdir(emptyDir, { recursive: true });

      const result = await listDirectory(emptyDir);
      assert.strictEqual(result.entries.length, 0);

      await fs.rm(emptyDir, { recursive: true });
    });
  });
});
