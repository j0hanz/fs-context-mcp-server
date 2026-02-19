import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import ignore, { type Ignore } from 'ignore';

import { isNodeError } from '../errors.js';

function normalizeToPosixPath(filePath: string): string {
  return filePath.replace(/\\/gu, '/');
}

export async function loadRootGitignore(
  root: string,
  signal?: AbortSignal
): Promise<Ignore | null> {
  const gitignorePath = path.join(root, '.gitignore');

  let contents: string;
  try {
    contents = await fs.readFile(gitignorePath, {
      encoding: 'utf-8',
      signal,
    });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  const matcher = ignore();
  matcher.add(
    contents
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  );

  return matcher;
}

export function isIgnoredByGitignore(
  matcher: Ignore,
  root: string,
  absolutePath: string,
  options: { isDirectory?: boolean } = {}
): boolean {
  const relative = path.relative(root, absolutePath);
  if (relative.length === 0) return false;

  const normalized = normalizeToPosixPath(relative);
  if (options.isDirectory) {
    return matcher.ignores(
      normalized.endsWith('/') ? normalized : `${normalized}/`
    );
  }
  return matcher.ignores(normalized);
}
