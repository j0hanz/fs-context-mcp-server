import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompleteRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import {
  getAllowedDirectories,
  isPathWithinDirectories,
  normalizePath,
} from './lib/path-validation.js';

const MAX_COMPLETION_ITEMS = 100;

interface CompletionResult {
  values: string[];
  total?: number;
  hasMore?: boolean;
}

function getSearchContext(currentValue: string): {
  searchDir: string;
  prefix: string;
} {
  const normalizedValue = normalizePath(currentValue);
  if (
    currentValue.endsWith(path.sep) ||
    currentValue.endsWith('/') ||
    currentValue.endsWith('\\')
  ) {
    return { searchDir: normalizedValue, prefix: '' };
  }
  return {
    searchDir: path.dirname(normalizedValue),
    prefix: path.basename(normalizedValue),
  };
}

async function findMatchesInDirectory(
  searchDir: string,
  prefix: string,
  allowed: string[]
): Promise<string[]> {
  const matches: string[] = [];
  if (!isPathWithinDirectories(searchDir, allowed)) {
    return matches;
  }

  try {
    const entries = await fs.readdir(searchDir, { withFileTypes: true });
    const lowerPrefix = prefix.toLowerCase();

    for (const entry of entries) {
      if (entry.name.toLowerCase().startsWith(lowerPrefix)) {
        const fullPath = path.join(searchDir, entry.name);
        const isDir = entry.isDirectory();
        matches.push(isDir ? `${fullPath}${path.sep}` : fullPath);
      }
    }
  } catch {
    // Access denied or not found, ignore
  }
  return matches;
}

function findMatchingRoots(
  searchDir: string,
  prefix: string,
  allowed: string[]
): string[] {
  const matches: string[] = [];
  const lowerPrefix = prefix.toLowerCase();

  for (const root of allowed) {
    const rootDir = path.dirname(root);
    // Check if root is a direct child of searchDir
    if (normalizePath(rootDir) === searchDir) {
      const rootName = path.basename(root);
      if (rootName.toLowerCase().startsWith(lowerPrefix)) {
        matches.push(`${root}${path.sep}`);
      }
    }
  }
  return matches;
}

export async function getPathCompletions(
  currentValue: string
): Promise<CompletionResult> {
  const allowed = getAllowedDirectories();
  // If empty, suggest allowed roots
  if (!currentValue) {
    return {
      values: allowed,
      total: allowed.length,
      hasMore: false,
    };
  }

  const { searchDir, prefix } = getSearchContext(currentValue);

  try {
    const dirMatches = await findMatchesInDirectory(searchDir, prefix, allowed);
    const rootMatches = findMatchingRoots(searchDir, prefix, allowed);

    // Deduplicate and sort
    const uniqueMatches = Array.from(new Set([...dirMatches, ...rootMatches]));

    uniqueMatches.sort((a, b) => {
      const aIsDir = a.endsWith(path.sep);
      const bIsDir = b.endsWith(path.sep);
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return a.localeCompare(b);
    });

    const sliced = uniqueMatches.slice(0, MAX_COMPLETION_ITEMS);

    return {
      values: sliced,
      total: uniqueMatches.length,
      hasMore: uniqueMatches.length > MAX_COMPLETION_ITEMS,
    };
  } catch {
    return { values: [] };
  }
}

export function registerCompletions(server: McpServer): void {
  server.server.setRequestHandler(CompleteRequestSchema, async (request) => {
    const { params } = request;
    const { argument } = params;

    const pathArguments = new Set([
      'path',
      'source',
      'destination',
      'original',
      'modified',
      'directory',
      'file',
      'root',
      'cwd',
    ]);

    // Check if argument name is relevant or ends with path-like suffixes
    const argName = argument.name.toLowerCase();
    const isPathArg =
      pathArguments.has(argName) ||
      argName.endsWith('path') ||
      argName.endsWith('file') ||
      argName.endsWith('dir');

    if (!isPathArg) {
      return { completion: { values: [], total: 0, hasMore: false } };
    }

    const { value } = argument;
    const completions = await getPathCompletions(value);

    return {
      completion: {
        values: completions.values,
        total: completions.total,
        hasMore: completions.hasMore,
      },
    };
  });
}
