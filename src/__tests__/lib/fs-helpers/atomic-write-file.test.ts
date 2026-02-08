import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { atomicWriteFile } from '../../../lib/fs-helpers.js';
import { withFileOpsFixture } from '../fixtures/file-ops-hooks.js';

void describe('atomicWriteFile', () => {
  withFileOpsFixture((getTestDir) => {
    void it('writes file content atomically', async () => {
      const filePath = path.join(getTestDir(), 'atomic.txt');
      const content = 'Atomic Content';
      await atomicWriteFile(filePath, content);

      const readBack = await fsp.readFile(filePath, 'utf-8');
      assert.strictEqual(readBack, content);
    });

    void it('overwrites existing file', async () => {
      const filePath = path.join(getTestDir(), 'overwrite.txt');
      await fsp.writeFile(filePath, 'Initial');

      await atomicWriteFile(filePath, 'Updated');

      const readBack = await fsp.readFile(filePath, 'utf-8');
      assert.strictEqual(readBack, 'Updated');
    });

    void it('cleans up temp file on abort', async () => {
      const filePath = path.join(getTestDir(), 'aborted.txt');
      const controller = new AbortController();
      const signal = controller.signal;
      controller.abort();

      await assert.rejects(
        atomicWriteFile(filePath, 'Should not write', { signal }),
        /AbortError/
      );

      // Verify no temp files left (simple check for files starting with abolished.txt.)
      const files = await fsp.readdir(getTestDir());
      const tempFiles = files.filter((f) => f.startsWith('aborted.txt.'));
      assert.strictEqual(tempFiles.length, 0);
    });
  });
});
