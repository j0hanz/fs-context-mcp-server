import * as path from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readFile } from '../../../lib/fs-helpers.js';
import { withFileOpsFixture } from '../fixtures/file-ops-hooks.js';

void describe('readFile', () => {
  withFileOpsFixture((getTestDir) => {
    void it('readFile reads file contents', async () => {
      const result = await readFile(path.join(getTestDir(), 'README.md'));
      assert.ok(result.content.includes('# Test Project'));
    });

    void it('readFile reads first N lines with head parameter', async () => {
      const result = await readFile(path.join(getTestDir(), 'multiline.txt'), {
        head: 5,
      });
      assert.ok(result.content.includes('Line 1'));
      assert.ok(result.content.includes('Line 5'));
      assert.strictEqual(result.truncated, true);
      assert.strictEqual(result.readMode, 'head');
    });

    void it('readFile reads an inclusive line range', async () => {
      const result = await readFile(path.join(getTestDir(), 'multiline.txt'), {
        startLine: 10,
        endLine: 12,
      });

      assert.strictEqual(result.readMode, 'range');
      assert.strictEqual(result.startLine, 10);
      assert.strictEqual(result.endLine, 12);
      assert.strictEqual(result.truncated, true);
      assert.strictEqual(result.hasMoreLines, true);
      assert.ok(result.content.includes('Line 10'));
      assert.ok(result.content.includes('Line 12'));
      assert.ok(!result.content.includes('Line 9'));
      assert.ok(!result.content.includes('Line 13'));
    });

    void it('readFile rejects non-files', async () => {
      await assert.rejects(readFile(getTestDir()), /Not a file/);
    });
  });
});
