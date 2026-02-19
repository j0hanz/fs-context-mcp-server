import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import { ErrorCode, isNodeError } from '../lib/errors.js';
import { withAbort } from '../lib/fs-helpers.js';
import {
  validateExistingPath,
  validatePathForWrite,
} from '../lib/path-validation.js';
import { MoveFileInputSchema, type MoveFileOutputSchema } from '../schemas.js';
import {
  buildToolErrorResponse,
  buildToolResponse,
  DESTRUCTIVE_WRITE_TOOL_ANNOTATIONS,
  executeToolWithDiagnostics,
  type ToolExtra,
  type ToolRegistrationOptions,
  type ToolResponse,
  type ToolResult,
  withDefaultIcons,
  wrapToolHandler,
} from './shared.js';
import { registerToolTaskIfAvailable } from './task-support.js';

const MOVE_FILE_TOOL = {
  title: 'Move File',
  description: 'Move or rename a file or directory.',
  inputSchema: MoveFileInputSchema,
  annotations: DESTRUCTIVE_WRITE_TOOL_ANNOTATIONS,
} as const;

async function handleMoveFile(
  args: z.infer<typeof MoveFileInputSchema>,
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof MoveFileOutputSchema>>> {
  const validSource = await validateExistingPath(args.source, signal);
  const validDest = await validatePathForWrite(args.destination, signal);

  // Ensure destination parent directory exists
  await withAbort(
    fs.mkdir(path.dirname(validDest), { recursive: true }),
    signal
  );

  try {
    await withAbort(fs.rename(validSource, validDest), signal);
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'EXDEV') {
      // Cross-device link, fallback to copy + delete
      await withAbort(
        fs.cp(validSource, validDest, { recursive: true }),
        signal
      );
      await withAbort(
        fs.rm(validSource, { recursive: true, force: true }),
        signal
      );
    } else {
      throw error;
    }
  }

  return buildToolResponse(
    `Successfully moved ${args.source} to ${args.destination}`,
    {
      ok: true,
      source: validSource,
      destination: validDest,
    }
  );
}

export function registerMoveFileTool(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  const handler = (
    args: z.infer<typeof MoveFileInputSchema>,
    extra: ToolExtra
  ): Promise<ToolResult<z.infer<typeof MoveFileOutputSchema>>> =>
    executeToolWithDiagnostics({
      toolName: 'mv',
      extra,
      timedSignal: {},
      context: { path: args.source },
      run: (signal) => handleMoveFile(args, signal),
      onError: (error) =>
        buildToolErrorResponse(error, ErrorCode.E_UNKNOWN, args.source),
    });

  const wrappedHandler = wrapToolHandler(handler, {
    guard: options.isInitialized,
    progressMessage: (args) =>
      `🛠 mv: ${path.basename(args.source)} ➟ ${path.basename(args.destination)}`,
  });
  if (
    registerToolTaskIfAvailable(
      server,
      'mv',
      MOVE_FILE_TOOL,
      wrappedHandler,
      options.iconInfo,
      options.isInitialized
    )
  )
    return;
  server.registerTool(
    'mv',
    withDefaultIcons({ ...MOVE_FILE_TOOL }, options.iconInfo),
    wrappedHandler
  );
}
