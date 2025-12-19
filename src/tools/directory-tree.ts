import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createErrorResponse, ErrorCode } from '../lib/errors.js';
import { getDirectoryTree } from '../lib/file-operations.js';
import { formatOperationSummary, formatTreeEntry } from '../lib/formatters.js';
import {
  DirectoryTreeInputSchema,
  DirectoryTreeOutputSchema,
} from '../schemas/index.js';
import { buildToolResponse, type ToolResponse } from './tool-response.js';

interface DirectoryTreeStructuredResult extends Record<string, unknown> {
  ok: true;
  tree: Awaited<ReturnType<typeof getDirectoryTree>>['tree'];
  summary: Awaited<ReturnType<typeof getDirectoryTree>>['summary'];
}

function buildStructuredResult(
  result: Awaited<ReturnType<typeof getDirectoryTree>>
): DirectoryTreeStructuredResult {
  return {
    ok: true,
    tree: result.tree,
    summary: result.summary,
  };
}

function buildTextResult(
  result: Awaited<ReturnType<typeof getDirectoryTree>>
): string {
  let textOutput = formatTreeEntry(result.tree);
  textOutput += formatOperationSummary({
    truncated: result.summary.truncated,
    truncatedReason: 'tree was truncated',
    tip: 'Increase maxDepth or maxFiles, or add excludePatterns to narrow scope.',
    skippedInaccessible: result.summary.skippedInaccessible,
    symlinksNotFollowed: result.summary.symlinksNotFollowed,
  });
  return textOutput;
}

async function handleDirectoryTree({
  path,
  maxDepth,
  excludePatterns,
  includeHidden,
  includeSize,
  maxFiles,
}: {
  path: string;
  maxDepth?: number;
  excludePatterns?: string[];
  includeHidden?: boolean;
  includeSize?: boolean;
  maxFiles?: number;
}): Promise<ToolResponse<DirectoryTreeStructuredResult>> {
  const result = await getDirectoryTree(path, {
    maxDepth,
    excludePatterns,
    includeHidden,
    includeSize,
    maxFiles,
  });
  const structured = buildStructuredResult(result);
  const textOutput = buildTextResult(result);
  return buildToolResponse(textOutput, structured);
}

const DIRECTORY_TREE_TOOL = {
  title: 'Directory Tree',
  description:
    'Generate a hierarchical JSON tree structure of a directory. ' +
    'More efficient for AI parsing than flat file lists. ' +
    'Ideal for understanding project layout and structure at a glance. ' +
    'Use maxDepth to limit traversal depth and excludePatterns to skip folders like node_modules. ' +
    'Optionally include file sizes with includeSize=true.',
  inputSchema: DirectoryTreeInputSchema,
  outputSchema: DirectoryTreeOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
} as const;

export function registerDirectoryTreeTool(server: McpServer): void {
  server.registerTool('directory_tree', DIRECTORY_TREE_TOOL, async (args) => {
    try {
      return await handleDirectoryTree(args);
    } catch (error) {
      return createErrorResponse(error, ErrorCode.E_NOT_DIRECTORY, args.path);
    }
  });
}
