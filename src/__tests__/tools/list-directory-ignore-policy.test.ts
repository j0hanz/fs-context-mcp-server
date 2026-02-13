import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { it } from 'node:test';

import { withAllToolsFixture } from '../shared/diagnostics-env.js';

void withAllToolsFixture((getHandler, getTestDir) => {
  void it('ls excludes ignored directories by default and includes them when requested', async () => {
    const root = getTestDir();
    const ignoredDir = path.join(root, 'node_modules', 'pkg');
    await fs.mkdir(ignoredDir, { recursive: true });
    await fs.writeFile(
      path.join(ignoredDir, 'index.js'),
      'module.exports = 1;'
    );

    const ls = getHandler('ls');

    const defaultResult = (await ls({ path: root }, {})) as {
      structuredContent?: { entries?: Array<{ name?: string }> };
    };
    const defaultNames =
      defaultResult.structuredContent?.entries?.map((entry) => entry.name) ??
      [];
    assert.ok(!defaultNames.includes('node_modules'));

    const includeIgnoredResult = (await ls(
      { path: root, includeIgnored: true },
      {}
    )) as {
      structuredContent?: { entries?: Array<{ name?: string }> };
    };
    const includeIgnoredNames =
      includeIgnoredResult.structuredContent?.entries?.map(
        (entry) => entry.name
      ) ?? [];
    assert.ok(includeIgnoredNames.includes('node_modules'));
  });
});
