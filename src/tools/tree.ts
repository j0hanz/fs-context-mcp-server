import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import { DEFAULT_SEARCH_TIMEOUT_MS } from '../lib/constants.js';
import { ErrorCode } from '../lib/errors.js';
import { formatTreeAscii, treeDirectory } from '../lib/file-operations/tree.js';
import { TreeInputSchema, type TreeOutputSchema } from '../schemas.js';
import {
  buildToolErrorResponse,
  buildToolResponse,
  executeToolWithDiagnostics,
  READ_ONLY_TOOL_ANNOTATIONS,
  resolvePathOrRoot,
  type ToolExtra,
  type ToolRegistrationOptions,
  type ToolResponse,
  type ToolResult,
  withDefaultIcons,
  wrapToolHandler,
} from './shared.js';
import { registerToolTaskIfAvailable } from './task-support.js';

const TREE_TOOL = {
  title: 'Tree',
  description:
    'Render a directory tree (bounded recursion). ' +
    'Returns an ASCII tree for quick scanning and a structured JSON tree for programmatic use. ' +
    'Note: maxDepth=0 returns only the root node with empty children array.',
  inputSchema: TreeInputSchema,
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
} as const;

async function handleTree(
  args: z.infer<typeof TreeInputSchema>,
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof TreeOutputSchema>>> {
  const basePath = resolvePathOrRoot(args.path);
  const result = await treeDirectory(basePath, {
    maxDepth: args.maxDepth,
    maxEntries: args.maxEntries,
    includeHidden: args.includeHidden,
    includeIgnored: args.includeIgnored,
    ...(signal ? { signal } : {}),
  });

  const ascii = formatTreeAscii(result.tree);

  const structured: z.infer<typeof TreeOutputSchema> = {
    ok: true,
    root: result.root,
    tree: result.tree,
    ascii,
    truncated: result.truncated,
    totalEntries: result.totalEntries,
  };

  const text = result.truncated ? `${ascii}\n[truncated]` : ascii;
  return buildToolResponse(text, structured);
}

export function registerTreeTool(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  const handler = (
    args: z.infer<typeof TreeInputSchema>,
    extra: ToolExtra
  ): Promise<ToolResult<z.infer<typeof TreeOutputSchema>>> => {
    const targetPath = args.path ?? '.';
    return executeToolWithDiagnostics({
      toolName: 'tree',
      extra,
      timedSignal: { timeoutMs: DEFAULT_SEARCH_TIMEOUT_MS },
      context: { path: targetPath },
      run: (signal) => handleTree(args, signal),
      onError: (error) =>
        buildToolErrorResponse(error, ErrorCode.E_NOT_DIRECTORY, targetPath),
    });
  };

  const wrappedHandler = wrapToolHandler(handler, {
    guard: options.isInitialized,
    progressMessage: (args) => {
      if (args.path) {
        return `≣ tree: ${path.basename(args.path)}`;
      }
      return '≣ tree';
    },
  });

  if (
    registerToolTaskIfAvailable(
      server,
      'tree',
      TREE_TOOL,
      wrappedHandler,
      options.iconInfo,
      options.isInitialized
    )
  )
    return;
  server.registerTool(
    'tree',
    withDefaultIcons({ ...TREE_TOOL }, options.iconInfo),
    wrappedHandler
  );
}
