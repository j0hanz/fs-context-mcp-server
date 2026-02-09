import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createTwoFilesPatch } from 'diff';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';

import { ErrorCode } from '../lib/errors.js';
import { createTimedAbortSignal } from '../lib/fs-helpers.js';
import { withToolDiagnostics } from '../lib/observability.js';
import { validateExistingPath } from '../lib/path-validation.js';
import { DiffFilesInputSchema, DiffFilesOutputSchema } from '../schemas.js';
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

const DIFF_FILES_TOOL = {
  name: 'diff_files',
  description: 'Generate a unified diff between two files.',
  inputSchema: DiffFilesInputSchema,
  outputSchema: DiffFilesOutputSchema,
} as const;

async function handleDiffFiles(
  args: z.infer<typeof DiffFilesInputSchema>,
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof DiffFilesOutputSchema>>> {
  const [originalPath, modifiedPath] = await Promise.all([
    validateExistingPath(args.original, signal),
    validateExistingPath(args.modified, signal),
  ]);

  const [originalContent, modifiedContent] = await Promise.all([
    fs.readFile(originalPath, { encoding: 'utf-8', signal }),
    fs.readFile(modifiedPath, { encoding: 'utf-8', signal }),
  ]);

  const patch = createTwoFilesPatch(
    path.basename(originalPath),
    path.basename(modifiedPath),
    originalContent,
    modifiedContent
  );

  return buildToolResponse(patch, {
    ok: true,
    diff: patch,
  });
}

export function registerDiffFilesTool(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  const handler = (
    args: z.infer<typeof DiffFilesInputSchema>,
    extra: ToolExtra
  ): Promise<ToolResult<z.infer<typeof DiffFilesOutputSchema>>> =>
    withToolDiagnostics(
      'diff_files',
      () =>
        withToolErrorHandling(
          async () => {
            const { signal, cleanup } = createTimedAbortSignal(extra.signal);
            try {
              return await handleDiffFiles(args, signal);
            } finally {
              cleanup();
            }
          },
          (error) =>
            buildToolErrorResponse(error, ErrorCode.E_UNKNOWN, args.original)
        ),
      { path: args.original }
    );

  server.registerTool(
    'diff_files',
    withDefaultIcons({ ...DIFF_FILES_TOOL }, options.iconInfo),
    wrapToolHandler(handler, {
      guard: options.isInitialized,
      progressMessage: (args) => {
        const name1 = path.basename(args.original);
        const name2 = path.basename(args.modified);
        return `diff: ${name1} ↔ ${name2}`;
      },
    })
  );
}
