import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import { ErrorCode } from '../lib/errors.js';
import { atomicWriteFile, withAbort } from '../lib/fs-helpers.js';
import { validatePathForWrite } from '../lib/path-validation.js';
import { WriteFileInputSchema, WriteFileOutputSchema } from '../schemas.js';
import {
  buildToolErrorResponse,
  buildToolResponse,
  executeToolWithDiagnostics,
  type ToolExtra,
  type ToolRegistrationOptions,
  type ToolResponse,
  type ToolResult,
  withDefaultIcons,
  wrapToolHandler,
} from './shared.js';
import { createToolTaskHandler, tryRegisterToolTask } from './task-support.js';

const WRITE_FILE_TOOL = {
  title: 'Write File',
  description:
    'Write content to a file. Creates the file if it does not exist.',
  inputSchema: WriteFileInputSchema,
  outputSchema: WriteFileOutputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
} as const;

async function handleWriteFile(
  args: z.infer<typeof WriteFileInputSchema>,
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof WriteFileOutputSchema>>> {
  const validPath = await validatePathForWrite(args.path, signal);

  // Ensure parent directory exists
  await withAbort(
    fs.mkdir(path.dirname(validPath), { recursive: true }),
    signal
  );

  await atomicWriteFile(validPath, args.content, { encoding: 'utf-8', signal });

  const stats = await withAbort(fs.stat(validPath), signal);

  return buildToolResponse(`Successfully wrote to file: ${args.path}`, {
    ok: true,
    path: validPath,
    bytesWritten: stats.size,
  });
}

export function registerWriteFileTool(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  const handler = (
    args: z.infer<typeof WriteFileInputSchema>,
    extra: ToolExtra
  ): Promise<ToolResult<z.infer<typeof WriteFileOutputSchema>>> =>
    executeToolWithDiagnostics({
      toolName: 'write',
      extra,
      timedSignal: {},
      context: { path: args.path },
      run: (signal) => handleWriteFile(args, signal),
      onError: (error) =>
        buildToolErrorResponse(error, ErrorCode.E_UNKNOWN, args.path),
    });

  const wrappedHandler = wrapToolHandler(handler, {
    guard: options.isInitialized,
    progressMessage: (args) => `🛠 write: ${path.basename(args.path)}`,
  });
  const taskOptions = options.isInitialized
    ? { guard: options.isInitialized }
    : undefined;
  if (
    tryRegisterToolTask(
      server,
      'write',
      WRITE_FILE_TOOL,
      createToolTaskHandler(wrappedHandler, taskOptions),
      options.iconInfo
    )
  )
    return;
  server.registerTool(
    'write',
    withDefaultIcons({ ...WRITE_FILE_TOOL }, options.iconInfo),
    wrappedHandler
  );
}
