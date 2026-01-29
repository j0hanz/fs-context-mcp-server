import * as path from 'node:path';

import {
  DEFAULT_EXCLUDE_PATTERNS,
  DEFAULT_SEARCH_TIMEOUT_MS,
} from '../constants.js';
import { createTimedAbortSignal } from '../fs-helpers.js';
import { isSensitivePath } from '../path-policy.js';
import {
  validateExistingDirectory,
  validateExistingPathDetailed,
} from '../path-validation.js';
import { isIgnoredByGitignore, loadRootGitignore } from './gitignore.js';
import { globEntries } from './glob-engine.js';

type TreeEntryType = 'file' | 'directory' | 'symlink' | 'other';

export interface TreeEntry {
  name: string;
  type: TreeEntryType;
  relativePath: string;
  children?: TreeEntry[];
}

export interface TreeOptions {
  maxDepth?: number;
  maxEntries?: number;
  includeHidden?: boolean;
  includeIgnored?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface NormalizedOptions {
  maxDepth: number;
  maxEntries: number;
  includeHidden: boolean;
  includeIgnored: boolean;
  timeoutMs: number;
}

export interface TreeResult {
  root: string;
  tree: TreeEntry;
  truncated: boolean;
  totalEntries: number;
}

function normalizeOptions(options: TreeOptions): NormalizedOptions {
  return {
    maxDepth: options.maxDepth ?? 5,
    maxEntries: options.maxEntries ?? 1000,
    includeHidden: options.includeHidden ?? false,
    includeIgnored: options.includeIgnored ?? false,
    timeoutMs: options.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS,
  };
}

function resolveEntryType(dirent: {
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  isFile(): boolean;
}): TreeEntryType {
  if (dirent.isDirectory()) return 'directory';
  if (dirent.isSymbolicLink()) return 'symlink';
  if (dirent.isFile()) return 'file';
  return 'other';
}

function ensureParentNodes(
  rootNode: TreeEntry,
  nodeByPath: Map<string, TreeEntry>,
  relativePath: string
): TreeEntry {
  const normalized = relativePath.replace(/\\/gu, '/');
  if (normalized.length === 0 || normalized === '.') return rootNode;

  const segments = normalized.split('/').filter((seg) => seg.length > 0);
  let current = rootNode;
  let currentPath = '';

  for (const segment of segments.slice(0, Math.max(0, segments.length - 1))) {
    currentPath =
      currentPath.length === 0 ? segment : `${currentPath}/${segment}`;

    let child = nodeByPath.get(currentPath);
    if (!child) {
      child = {
        name: segment,
        type: 'directory',
        relativePath: currentPath,
        children: [],
      };
      nodeByPath.set(currentPath, child);
      current.children ??= [];
      current.children.push(child);
    }

    current = child;
  }

  return current;
}

function sortTree(node: TreeEntry): void {
  if (!node.children) return;
  node.children.sort((a, b) => {
    const typeRank = (t: TreeEntryType): number => {
      if (t === 'directory') return 0;
      if (t === 'file') return 1;
      return 2;
    };
    const diff = typeRank(a.type) - typeRank(b.type);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) {
    sortTree(child);
  }
}

function getStopReason(
  signal: AbortSignal,
  totalEntries: number,
  maxEntries: number
): 'aborted' | 'maxEntries' | undefined {
  if (signal.aborted) {
    return 'aborted';
  }
  if (totalEntries >= maxEntries) {
    return 'maxEntries';
  }
  return undefined;
}

async function resolveTreeEntry(
  entry: {
    path: string;
    dirent: {
      isDirectory(): boolean;
      isSymbolicLink(): boolean;
      isFile(): boolean;
    };
  },
  root: string,
  gitignoreMatcher: Awaited<ReturnType<typeof loadRootGitignore>>,
  signal: AbortSignal
): Promise<{
  type: TreeEntryType;
  relativePosix: string;
  name: string;
} | null> {
  try {
    const validated = await validateExistingPathDetailed(entry.path, signal);
    if (isSensitivePath(validated.requestedPath, validated.resolvedPath)) {
      return null;
    }
  } catch {
    return null;
  }

  const type = resolveEntryType(entry.dirent);
  if (
    gitignoreMatcher &&
    isIgnoredByGitignore(gitignoreMatcher, root, entry.path, {
      isDirectory: type === 'directory',
    })
  ) {
    return null;
  }

  const relative = path.relative(root, entry.path) || path.basename(entry.path);
  const relativePosix = relative.replace(/\\/gu, '/');
  const name = path.basename(entry.path);
  return { type, relativePosix, name };
}

export function formatTreeAscii(tree: TreeEntry): string {
  const lines: string[] = [];

  const walk = (
    node: TreeEntry,
    prefix: string,
    isLast: boolean,
    isRoot: boolean
  ): void => {
    let connector = '';
    let linePrefix = '';
    if (!isRoot) {
      connector = isLast ? '└── ' : '├── ';
      linePrefix = prefix;
    }
    lines.push(`${linePrefix}${connector}${node.name}`);

    if (!node.children || node.children.length === 0) return;

    let nextPrefix = '';
    if (!isRoot) {
      const continuation = isLast ? '    ' : '│   ';
      nextPrefix = `${prefix}${continuation}`;
    }

    const count = node.children.length;
    node.children.forEach((child, index) => {
      walk(child, nextPrefix, index === count - 1, false);
    });
  };

  walk(tree, '', true, true);
  return lines.join('\n');
}

export async function treeDirectory(
  dirPath: string,
  options: TreeOptions = {}
): Promise<TreeResult> {
  const normalized = normalizeOptions(options);
  const { signal, cleanup } = createTimedAbortSignal(
    options.signal,
    normalized.timeoutMs
  );

  const root = await validateExistingDirectory(dirPath, signal);

  try {
    const excludePatterns = normalized.includeIgnored
      ? []
      : DEFAULT_EXCLUDE_PATTERNS;

    const gitignoreMatcher = normalized.includeIgnored
      ? null
      : await loadRootGitignore(root, signal);

    const rootNode: TreeEntry = {
      name: path.basename(root) || root,
      type: 'directory',
      relativePath: '.',
      children: [],
    };

    const nodeByPath = new Map<string, TreeEntry>();
    let totalEntries = 0;
    let truncated = false;

    const stream = globEntries({
      cwd: root,
      pattern: '**/*',
      excludePatterns,
      includeHidden: normalized.includeHidden,
      baseNameMatch: false,
      caseSensitiveMatch: true,
      maxDepth: normalized.maxDepth,
      followSymbolicLinks: false,
      onlyFiles: false,
      stats: false,
      suppressErrors: true,
    });

    for await (const entry of stream) {
      const stopReason = getStopReason(
        signal,
        totalEntries,
        normalized.maxEntries
      );
      if (stopReason) {
        truncated = true;
        break;
      }

      const resolved = await resolveTreeEntry(
        entry,
        root,
        gitignoreMatcher,
        signal
      );
      if (!resolved) {
        continue;
      }

      const parent = ensureParentNodes(
        rootNode,
        nodeByPath,
        resolved.relativePosix
      );

      const node: TreeEntry = {
        name: resolved.name,
        type: resolved.type,
        relativePath: resolved.relativePosix,
        ...(resolved.type === 'directory'
          ? { children: [] as TreeEntry[] }
          : {}),
      };

      nodeByPath.set(resolved.relativePosix, node);
      parent.children ??= [];
      parent.children.push(node);
      totalEntries += 1;
    }

    sortTree(rootNode);

    return {
      root,
      tree: rootNode,
      truncated,
      totalEntries,
    };
  } finally {
    cleanup();
  }
}
