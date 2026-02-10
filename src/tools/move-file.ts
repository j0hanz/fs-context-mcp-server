import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import { ErrorCode, isNodeError } from '../lib/errors.js';
import { createTimedAbortSignal, withAbort } from '../lib/fs-helpers.js';
import { withToolDiagnostics } from '../lib/observability.js';
import {
  validateExistingPath,
  validatePathForWrite,
} from '../lib/path-validation.js';
import { MoveFileInputSchema, MoveFileOutputSchema } from '../schemas.js';
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

const MOVE_FILE_TOOL = {
  title: 'Move File',
  description: 'Move or rename a file or directory.',
  inputSchema: MoveFileInputSchema,
  outputSchema: MoveFileOutputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
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
    withToolDiagnostics(
      'mv',
      () =>
        withToolErrorHandling(
          async () => {
            const { signal, cleanup } = createTimedAbortSignal(extra.signal);
            try {
              return await handleMoveFile(args, signal);
            } finally {
              cleanup();
            }
          },
          (error) =>
            buildToolErrorResponse(error, ErrorCode.E_UNKNOWN, args.source)
        ),
      { path: args.source }
    );

  server.registerTool(
    'mv',
    withDefaultIcons({ ...MOVE_FILE_TOOL }, options.iconInfo),
    wrapToolHandler(handler, {
      guard: options.isInitialized,
      progressMessage: (args) =>
        `→ mv: ${path.basename(args.source)} -> ${path.basename(args.destination)}`,
    })
  );
}
