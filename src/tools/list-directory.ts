import * as pathModule from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createErrorResponse, ErrorCode } from '../lib/errors.js';
import { listDirectory } from '../lib/file-operations.js';
import {
  formatDirectoryListing,
  formatOperationSummary,
} from '../lib/formatters.js';
import {
  ListDirectoryInputSchema,
  ListDirectoryOutputSchema,
} from '../schemas/index.js';
import { buildToolResponse, type ToolResponse } from './tool-response.js';

function getExtension(name: string, isFile: boolean): string | undefined {
  if (!isFile) return undefined;
  const ext = pathModule.extname(name);
  return ext ? ext.slice(1) : undefined;
}

const LIST_DIRECTORY_TOOL = {
  title: 'List Directory',
  description:
    'List files and subdirectories in a specified path with optional recursive traversal. ' +
    'Returns names, types (file/directory/symlink), sizes, and modification dates. ' +
    'Use recursive=true with maxDepth to explore nested structures. ' +
    'For a visual tree structure, use directory_tree instead.',
  inputSchema: ListDirectoryInputSchema,
  outputSchema: ListDirectoryOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
} as const;

interface ListDirectoryStructuredResult extends Record<string, unknown> {
  ok: true;
  path: string;
  entries: {
    name: string;
    type: string;
    extension?: string;
    size?: number;
    modified?: string;
    symlinkTarget?: string;
  }[];
  summary: {
    totalEntries: number;
    totalFiles: number;
    totalDirectories: number;
    maxDepthReached: number;
    truncated: boolean;
    skippedInaccessible: number;
    symlinksNotFollowed: number;
  };
}

function buildStructuredResult(
  result: Awaited<ReturnType<typeof listDirectory>>
): ListDirectoryStructuredResult {
  return {
    ok: true,
    path: result.path,
    entries: result.entries.map((e) => ({
      name: e.relativePath,
      type: e.type,
      extension: getExtension(e.relativePath, e.type === 'file'),
      size: e.size,
      modified: e.modified?.toISOString(),
      symlinkTarget: e.symlinkTarget,
    })),
    summary: {
      totalEntries: result.summary.totalEntries,
      totalFiles: result.summary.totalFiles,
      totalDirectories: result.summary.totalDirectories,
      maxDepthReached: result.summary.maxDepthReached,
      truncated: result.summary.truncated,
      skippedInaccessible: result.summary.skippedInaccessible,
      symlinksNotFollowed: result.summary.symlinksNotFollowed,
    },
  };
}

function buildTextResult(
  result: Awaited<ReturnType<typeof listDirectory>>
): string {
  let textOutput = formatDirectoryListing(result.entries, result.path);
  textOutput += formatOperationSummary({
    truncated: result.summary.truncated,
    truncatedReason: `reached max entries limit (${result.summary.totalEntries} returned)`,
    tip: 'Increase maxEntries or reduce maxDepth to see more results.',
    skippedInaccessible: result.summary.skippedInaccessible,
    symlinksNotFollowed: result.summary.symlinksNotFollowed,
  });
  return textOutput;
}

async function handleListDirectory({
  path: dirPath,
  recursive,
  includeHidden,
  maxDepth,
  maxEntries,
  sortBy,
  includeSymlinkTargets,
}: {
  path: string;
  recursive?: boolean;
  includeHidden?: boolean;
  maxDepth?: number;
  maxEntries?: number;
  sortBy?: 'name' | 'size' | 'modified' | 'type';
  includeSymlinkTargets?: boolean;
}): Promise<ToolResponse<ListDirectoryStructuredResult>> {
  const result = await listDirectory(dirPath, {
    recursive,
    includeHidden,
    maxDepth,
    maxEntries,
    sortBy,
    includeSymlinkTargets,
  });
  const structured = buildStructuredResult(result);
  const textOutput = buildTextResult(result);
  return buildToolResponse(textOutput, structured);
}

export function registerListDirectoryTool(server: McpServer): void {
  server.registerTool('list_directory', LIST_DIRECTORY_TOOL, async (args) => {
    try {
      return await handleListDirectory(args);
    } catch (error) {
      return createErrorResponse(error, ErrorCode.E_NOT_DIRECTORY, args.path);
    }
  });
}
