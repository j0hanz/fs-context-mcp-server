import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { FileInfo } from '../../config/types.js';
import { getMimeType } from '../constants.js';
import { getFileType, isHidden } from '../fs-helpers.js';
import { validateExistingPathDetailed } from '../path-validation.js';

const PERM_STRINGS = [
  '---',
  '--x',
  '-w-',
  '-wx',
  'r--',
  'r-x',
  'rw-',
  'rwx',
] as const satisfies readonly string[];

function getPermissions(mode: number): string {
  const ownerIndex = (mode >> 6) & 0b111;
  const groupIndex = (mode >> 3) & 0b111;
  const otherIndex = mode & 0b111;
  const owner = PERM_STRINGS[ownerIndex] ?? '---';
  const group = PERM_STRINGS[groupIndex] ?? '---';
  const other = PERM_STRINGS[otherIndex] ?? '---';

  return `${owner}${group}${other}`;
}

async function getSymlinkTarget(
  pathToRead: string
): Promise<string | undefined> {
  try {
    return await fs.readlink(pathToRead);
  } catch {
    return undefined;
  }
}

export async function getFileInfo(
  filePath: string,
  options: { includeMimeType?: boolean } = {}
): Promise<FileInfo> {
  const { requestedPath, resolvedPath, isSymlink } =
    await validateExistingPathDetailed(filePath);

  const name = path.basename(requestedPath);
  const ext = path.extname(name).toLowerCase();
  const includeMimeType = options.includeMimeType !== false;
  const mimeType = includeMimeType && ext ? getMimeType(ext) : undefined;
  const symlinkTarget = isSymlink
    ? await getSymlinkTarget(requestedPath)
    : undefined;

  const stats = await fs.stat(resolvedPath);

  return {
    name,
    path: requestedPath,
    type: isSymlink ? 'symlink' : getFileType(stats),
    size: stats.size,
    created: stats.birthtime,
    modified: stats.mtime,
    accessed: stats.atime,
    permissions: getPermissions(stats.mode),
    isHidden: isHidden(name),
    mimeType,
    symlinkTarget,
  };
}
