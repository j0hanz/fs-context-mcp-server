import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import { ErrorCode, isNodeError } from '../lib/errors.js';
import { createTimedAbortSignal, withAbort } from '../lib/fs-helpers.js';
import { withToolDiagnostics } from '../lib/observability.js';
import { validatePathForWrite } from '../lib/path-validation.js';
import { DeleteFileInputSchema, DeleteFileOutputSchema } from '../schemas.js';
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

const DELETE_FILE_TOOL = {
  title: 'Delete File',
  description: 'Delete a file or directory.',
  inputSchema: DeleteFileInputSchema,
  outputSchema: DeleteFileOutputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
} as const;

async function handleDeleteFile(
  args: z.infer<typeof DeleteFileInputSchema>,
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof DeleteFileOutputSchema>>> {
  const validPath = await validatePathForWrite(args.path, signal);

  let stats: Awaited<ReturnType<typeof fs.lstat>> | undefined;
  try {
    stats = await withAbort(fs.lstat(validPath), signal);
  } catch (error) {
    if (
      isNodeError(error) &&
      error.code === 'ENOENT' &&
      args.ignoreIfNotExists
    ) {
      return buildToolResponse(`Successfully deleted: ${args.path}`, {
        ok: true,
        path: validPath,
      });
    }
    throw error;
  }

  if (stats.isDirectory() && !args.recursive) {
    // Use rmdir for non-recursive directory deletes so non-empty directories
    // consistently return ENOTEMPTY-style errors with actionable guidance.
    await withAbort(fs.rmdir(validPath), signal);
  } else {
    await withAbort(
      fs.rm(validPath, {
        recursive: args.recursive,
        force: args.ignoreIfNotExists,
      }),
      signal
    );
  }

  return buildToolResponse(`Successfully deleted: ${args.path}`, {
    ok: true,
    path: validPath,
  });
}

export function registerDeleteFileTool(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  const handler = (
    args: z.infer<typeof DeleteFileInputSchema>,
    extra: ToolExtra
  ): Promise<ToolResult<z.infer<typeof DeleteFileOutputSchema>>> =>
    withToolDiagnostics(
      'rm',
      () =>
        withToolErrorHandling(
          async () => {
            const { signal, cleanup } = createTimedAbortSignal(extra.signal);
            try {
              return await handleDeleteFile(args, signal);
            } finally {
              cleanup();
            }
          },
          (error) => {
            if (isNodeError(error)) {
              if (error.code === 'ENOENT') {
                return buildToolErrorResponse(
                  error,
                  ErrorCode.E_NOT_FOUND,
                  args.path
                );
              }
              if (error.code === 'ENOTEMPTY') {
                return buildToolErrorResponse(
                  new Error(
                    `Directory is not empty: ${args.path}. Use recursive: true to delete non-empty directories.`
                  ),
                  ErrorCode.E_INVALID_INPUT,
                  args.path
                );
              }
              if (error.code === 'EISDIR') {
                return buildToolErrorResponse(
                  new Error(
                    `Path is a directory: ${args.path}. Use recursive: true to delete directories.`
                  ),
                  ErrorCode.E_INVALID_INPUT,
                  args.path
                );
              }
              if (error.code === 'EEXIST') {
                return buildToolErrorResponse(
                  new Error(
                    `Directory is not empty: ${args.path}. Use recursive: true to delete non-empty directories.`
                  ),
                  ErrorCode.E_INVALID_INPUT,
                  args.path
                );
              }
              if (error.code === 'EPERM' || error.code === 'EACCES') {
                return buildToolErrorResponse(
                  error,
                  ErrorCode.E_PERMISSION_DENIED,
                  args.path
                );
              }
            }
            return buildToolErrorResponse(
              error,
              ErrorCode.E_UNKNOWN,
              args.path
            );
          }
        ),
      { path: args.path }
    );

  server.registerTool(
    'rm',
    withDefaultIcons({ ...DELETE_FILE_TOOL }, options.iconInfo),
    wrapToolHandler(handler, {
      guard: options.isInitialized,
      progressMessage: (args) => `🛠 rm: ${path.basename(args.path)}`,
    })
  );
}
