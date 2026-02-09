import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { applyPatch } from 'diff';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';

import { ErrorCode, McpError } from '../lib/errors.js';
import { atomicWriteFile, createTimedAbortSignal } from '../lib/fs-helpers.js';
import { withToolDiagnostics } from '../lib/observability.js';
import { validateExistingPath } from '../lib/path-validation.js';
import { ApplyPatchInputSchema, ApplyPatchOutputSchema } from '../schemas.js';
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

const APPLY_PATCH_TOOL = {
  name: 'apply_patch',
  description: 'Apply a unified patch to a file.',
  inputSchema: ApplyPatchInputSchema,
  outputSchema: ApplyPatchOutputSchema,
} as const;

async function handleApplyPatch(
  args: z.infer<typeof ApplyPatchInputSchema>,
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof ApplyPatchOutputSchema>>> {
  const validPath = await validateExistingPath(args.path, signal);
  const content = await fs.readFile(validPath, { encoding: 'utf-8', signal });

  const patched = applyPatch(content, args.patch, {
    fuzzFactor: args.fuzzy ? 2 : 0,
  });

  if (patched === false) {
    throw new McpError(
      ErrorCode.E_INVALID_INPUT,
      `Patch application failed. The file content may have changed or the patch context is insufficient. Try enable fuzzy matching.`
    );
  }

  if (args.dryRun) {
    return buildToolResponse('Dry run successful. Patch can be applied.', {
      ok: true,
      path: validPath,
      applied: true,
    });
  }

  await atomicWriteFile(validPath, patched, { encoding: 'utf-8', signal });

  return buildToolResponse(`Successfully patched ${args.path}`, {
    ok: true,
    path: validPath,
    applied: true,
  });
}

export function registerApplyPatchTool(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  const handler = (
    args: z.infer<typeof ApplyPatchInputSchema>,
    extra: ToolExtra
  ): Promise<ToolResult<z.infer<typeof ApplyPatchOutputSchema>>> =>
    withToolDiagnostics(
      'apply_patch',
      () =>
        withToolErrorHandling(
          async () => {
            const { signal, cleanup } = createTimedAbortSignal(extra.signal);
            try {
              return await handleApplyPatch(args, signal);
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
    'apply_patch',
    withDefaultIcons({ ...APPLY_PATCH_TOOL }, options.iconInfo),
    wrapToolHandler(handler, {
      guard: options.isInitialized,
      progressMessage: (args) => {
        const name = path.basename(args.path);
        return `patch: ${name}`;
      },
    })
  );
}
