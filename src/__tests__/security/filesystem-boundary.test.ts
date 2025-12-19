import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import fg from 'fast-glob';
import { describe, expect, it } from 'vitest';

function getRepoRoot(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  // src/__tests__/security -> repo root
  return path.resolve(currentDir, '../../../../');
}

function hasFsImport(source: string): boolean {
  return (
    /from\s+['"]node:fs\/promises['"]/u.test(source) ||
    /from\s+['"]node:fs['"]/u.test(source)
  );
}

describe('security boundary: filesystem access', () => {
  it('keeps direct node:fs imports inside boundary modules', async () => {
    const repoRoot = getRepoRoot();

    const sourceFiles = await fg(['src/**/*.ts'], {
      cwd: repoRoot,
      ignore: ['src/__tests__/**'],
      onlyFiles: true,
      dot: false,
    });

    // These files are allowed to import node:fs*/ because they either:
    // - implement the security boundary itself
    // - centralize filesystem operations
    // - bootstrap the server before allowed directories exist
    const allowedFsImportFiles = new Set<string>([
      'src/server.ts',
      'src/lib/path-validation.ts',
      'src/lib/file-operations.ts',
      'src/lib/fs-helpers.ts',
      'src/lib/file-operations/search-content.ts',
    ]);

    const offenders: string[] = [];

    for (const relPath of sourceFiles) {
      const absPath = path.join(repoRoot, relPath);
      const content = await fs.readFile(absPath, 'utf-8');

      if (!hasFsImport(content)) {
        continue;
      }

      if (!allowedFsImportFiles.has(relPath.replace(/\\/gu, '/'))) {
        offenders.push(relPath);
      }
    }

    expect(
      offenders,
      `Unexpected node:fs imports detected outside boundary modules. ` +
        `To keep "validate-before-access" auditable, route filesystem access through ` +
        `src/lib/file-operations.ts and src/lib/fs-helpers.ts (and validate paths in src/lib/path-validation.ts).`
    ).toEqual([]);
  });
});
