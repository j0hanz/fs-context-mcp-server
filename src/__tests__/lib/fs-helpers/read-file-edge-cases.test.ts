import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readFile } from '../../../lib/fs-helpers.js';
import { withFileOpsFixture } from '../fixtures/file-ops-hooks.js';

void describe('readFile edge cases', () => {
  withFileOpsFixture((getTestDir) => {
    void it('readFile head read is not truncated when file is shorter than head', async () => {
      const result = await readFile(path.join(getTestDir(), 'multiline.txt'), {
        head: 200,
      });
      assert.ok(result.content.includes('Line 100'));
      assert.strictEqual(result.truncated, false);
      assert.strictEqual(result.hasMoreLines, false);
    });

    void it('readFile handles empty file', async () => {
      const emptyFile = path.join(getTestDir(), 'empty-read.txt');
      await fs.writeFile(emptyFile, '');

      const result = await readFile(emptyFile);
      assert.strictEqual(result.content, '');
      assert.strictEqual(result.truncated, false);

      await fs.rm(emptyFile);
    });

    void it('readFile rejects binary files without suggesting unsupported tool options', async () => {
      const binaryFile = path.join(getTestDir(), 'image.png');
      await assert.rejects(
        readFile(binaryFile, { skipBinary: true }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(error.message.includes('Binary file detected'));
          assert.ok(!error.message.includes('skipBinary'));
          return true;
        }
      );
    });
  });
});
