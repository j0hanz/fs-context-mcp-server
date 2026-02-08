import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import { DEFAULT_SEARCH_TIMEOUT_MS } from '../lib/constants.js';
import { ErrorCode } from '../lib/errors.js';
import { formatTreeAscii, treeDirectory } from '../lib/file-operations/tree.js';
import { createTimedAbortSignal } from '../lib/fs-helpers.js';
import { withToolDiagnostics } from '../lib/observability.js';
import { TreeInputSchema, TreeOutputSchema } from '../schemas.js';
import {
  buildToolErrorResponse,
  buildToolResponse,
  resolvePathOrRoot,
  type ToolExtra,
  type ToolRegistrationOptions,
  type ToolResponse,
  type ToolResult,
  withDefaultIcons,
  withToolErrorHandling,
  wrapToolHandler,
} from './shared.js';

const TREE_TOOL = {
  title: 'Tree',
  description:
    'Render a directory tree (bounded recursion). ' +
    'Returns an ASCII tree for quick scanning and a structured JSON tree for programmatic use.',
  inputSchema: TreeInputSchema,
  outputSchema: TreeOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
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
    return withToolDiagnostics(
      'tree',
      () =>
        withToolErrorHandling(
          async () => {
            const { signal, cleanup } = createTimedAbortSignal(
              extra.signal,
              DEFAULT_SEARCH_TIMEOUT_MS
            );
            try {
              return await handleTree(args, signal);
            } finally {
              cleanup();
            }
          },
          (error) =>
            buildToolErrorResponse(error, ErrorCode.E_NOT_DIRECTORY, targetPath)
        ),
      { path: targetPath }
    );
  };

  server.registerTool(
    'tree',
    withDefaultIcons({ ...TREE_TOOL }, options.iconInfo),
    wrapToolHandler(handler, {
      guard: options.isInitialized,
      progressMessage: (args) => {
        if (args.path) {
          return `tree | ${path.basename(args.path)}`;
        }
        return 'tree';
      },
    })
  );
}
