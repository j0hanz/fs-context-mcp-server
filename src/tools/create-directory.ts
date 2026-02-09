import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import { ErrorCode } from '../lib/errors.js';
import { createTimedAbortSignal, withAbort } from '../lib/fs-helpers.js';
import { withToolDiagnostics } from '../lib/observability.js';
import { validatePathForWrite } from '../lib/path-validation.js';
import {
  CreateDirectoryInputSchema,
  CreateDirectoryOutputSchema,
} from '../schemas.js';
import {
  buildToolErrorResponse,
  buildToolResponse,
  type ToolExtra,
  type ToolRegistrationOptions,
  type ToolResponse,
  type ToolResult,
  withDefaultIcons,
  withToolErrorHandling,
  wrapToolHandler,
} from './shared.js';

const CREATE_DIRECTORY_TOOL = {
  title: 'Create Directory',
  description: 'Create a new directory at the specified path (recursive)',
  inputSchema: CreateDirectoryInputSchema,
  outputSchema: CreateDirectoryOutputSchema,
  annotations: {
    readOnlyHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

async function handleCreateDirectory(
  args: z.infer<typeof CreateDirectoryInputSchema>,
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof CreateDirectoryOutputSchema>>> {
  const validPath = await validatePathForWrite(args.path, signal);

  await withAbort(fs.mkdir(validPath, { recursive: true }), signal);

  return buildToolResponse(`Successfully created directory: ${args.path}`, {
    ok: true,
    path: validPath,
  });
}

export function registerCreateDirectoryTool(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  const handler = (
    args: z.infer<typeof CreateDirectoryInputSchema>,
    extra: ToolExtra
  ): Promise<ToolResult<z.infer<typeof CreateDirectoryOutputSchema>>> =>
    withToolDiagnostics(
      'mkdir',
      () =>
        withToolErrorHandling(
          async () => {
            const { signal, cleanup } = createTimedAbortSignal(extra.signal);
            try {
              return await handleCreateDirectory(args, signal);
            } finally {
              cleanup();
            }
          },
          (error) =>
            buildToolErrorResponse(error, ErrorCode.E_UNKNOWN, args.path)
        ),
      { path: args.path }
    );

  server.registerTool(
    'mkdir',
    withDefaultIcons({ ...CREATE_DIRECTORY_TOOL }, options.iconInfo),
    wrapToolHandler(handler, {
      guard: options.isInitialized,
      progressMessage: (args) => `mkdir: ${path.basename(args.path)}`,
    })
  );
}
