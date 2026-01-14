import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatTreeAscii,
  treeDirectory,
} from '../../../lib/file-operations/tree.js';
import { withFileOpsFixture } from '../fixtures/file-ops-hooks.js';

void describe('treeDirectory', () => {
  withFileOpsFixture((getTestDir) => {
    void it('treeDirectory returns a bounded directory tree', async () => {
      const result = await treeDirectory(getTestDir(), { maxDepth: 1 });
      assert.strictEqual(result.tree.type, 'directory');
      assert.strictEqual(result.truncated, false);
      assert.ok(Array.isArray(result.tree.children));

      const names = (result.tree.children ?? []).map((c) => c.name);
      assert.ok(names.includes('README.md'));
      assert.ok(names.includes('src'));
      assert.ok(names.includes('docs'));
    });

    void it('treeDirectory respects root .gitignore by default', async () => {
      const gitignorePath = path.join(getTestDir(), '.gitignore');
      await fs.writeFile(gitignorePath, 'docs/\n');

      try {
        const result = await treeDirectory(getTestDir(), { maxDepth: 5 });
        interface Node {
          relativePath: string;
          children?: Node[];
        }

        const flatten = (node: Node): string[] => {
          const out: string[] = [node.relativePath];
          for (const child of node.children ?? []) out.push(...flatten(child));
          return out;
        };

        const paths = flatten(result.tree as unknown as Node);
        assert.strictEqual(
          paths.some((p) => p === 'docs' || p.startsWith('docs/')),
          false
        );
      } finally {
        await fs.rm(gitignorePath, { force: true });
      }
    });

    void it('treeDirectory can include ignored entries when requested', async () => {
      const gitignorePath = path.join(getTestDir(), '.gitignore');
      await fs.writeFile(gitignorePath, 'docs/\n');

      try {
        const result = await treeDirectory(getTestDir(), {
          includeIgnored: true,
          maxDepth: 2,
        });

        const names = (result.tree.children ?? []).map((c) => c.name);
        assert.ok(names.includes('docs'));
      } finally {
        await fs.rm(gitignorePath, { force: true });
      }
    });

    void it('formatTreeAscii renders a tree with connectors', async () => {
      const result = await treeDirectory(getTestDir(), { maxDepth: 2 });
      const ascii = formatTreeAscii(result.tree);
      assert.ok(
        ascii.includes('└── ') || ascii.includes('├── '),
        `Expected connectors in ASCII tree output, got:\n${ascii}`
      );
    });
  });
});
