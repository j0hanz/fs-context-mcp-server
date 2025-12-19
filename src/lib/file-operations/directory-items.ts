import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Dirent, Stats } from 'node:fs';

import type { DirectoryEntry, FileType } from '../../config/types.js';
import { getFileType } from '../fs-helpers.js';
import { validateExistingPath } from '../path-validation.js';

export interface DirectoryItemResult {
  entry: DirectoryEntry;
  enqueueDir?: { currentPath: string; depth: number };
  skippedInaccessible?: boolean;
  symlinkNotFollowed?: boolean;
}

interface DirectoryItemOptions {
  includeSymlinkTargets: boolean;
  recursive: boolean;
  depth: number;
  maxDepth: number;
}

function buildEntryBase(
  item: Dirent,
  fullPath: string,
  relativePath: string,
  type: FileType
): DirectoryEntry {
  return {
    name: item.name,
    path: fullPath,
    relativePath,
    type,
  };
}

function resolveEntryType(item: Dirent, stats: Stats): FileType {
  if (item.isDirectory()) return 'directory';
  if (item.isFile()) return 'file';
  return getFileType(stats);
}

async function buildSymlinkResult(
  item: Dirent,
  fullPath: string,
  relativePath: string,
  includeSymlinkTargets: boolean
): Promise<DirectoryItemResult> {
  const stats = await fs.lstat(fullPath);
  let symlinkTarget: string | undefined;

  if (includeSymlinkTargets) {
    try {
      symlinkTarget = await fs.readlink(fullPath);
    } catch {
      symlinkTarget = undefined;
    }
  }

  const entry: DirectoryEntry = {
    name: item.name,
    path: fullPath,
    relativePath,
    type: 'symlink',
    size: stats.size,
    modified: stats.mtime,
    symlinkTarget,
  };

  return { entry, symlinkNotFollowed: true };
}

async function buildEnqueueDir(
  fullPath: string,
  depth: number,
  maxDepth: number,
  recursive: boolean
): Promise<{ currentPath: string; depth: number } | undefined> {
  if (!recursive || depth + 1 > maxDepth) return undefined;

  return {
    currentPath: await validateExistingPath(fullPath),
    depth: depth + 1,
  };
}

async function buildRegularResult(
  item: Dirent,
  fullPath: string,
  relativePath: string,
  options: DirectoryItemOptions
): Promise<DirectoryItemResult> {
  const stats = await fs.stat(fullPath);
  const type = resolveEntryType(item, stats);

  const entry: DirectoryEntry = {
    ...buildEntryBase(item, fullPath, relativePath, type),
    size: type === 'file' ? stats.size : undefined,
    modified: stats.mtime,
  };

  const enqueueDir = await buildEnqueueDir(
    fullPath,
    options.depth,
    options.maxDepth,
    options.recursive
  );

  return { entry, enqueueDir };
}

function buildFallbackEntry(
  item: Dirent,
  fullPath: string,
  relativePath: string
): DirectoryItemResult {
  const type: FileType = item.isDirectory()
    ? 'directory'
    : item.isFile()
      ? 'file'
      : 'other';

  return {
    entry: buildEntryBase(item, fullPath, relativePath, type),
    skippedInaccessible: true,
  };
}

export async function buildDirectoryItemResult(
  item: Dirent,
  currentPath: string,
  basePath: string,
  options: DirectoryItemOptions
): Promise<DirectoryItemResult> {
  const fullPath = path.join(currentPath, item.name);
  const relativePath = path.relative(basePath, fullPath) || item.name;

  try {
    if (item.isSymbolicLink()) {
      return await buildSymlinkResult(
        item,
        fullPath,
        relativePath,
        options.includeSymlinkTargets
      );
    }

    return await buildRegularResult(item, fullPath, relativePath, options);
  } catch {
    return buildFallbackEntry(item, fullPath, relativePath);
  }
}
