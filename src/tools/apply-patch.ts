import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import { applyPatch } from 'diff';

import { MAX_TEXT_FILE_SIZE } from '../lib/constants.js';
import { ErrorCode, McpError } from '../lib/errors.js';
import {
  atomicWriteFile,
  createTimedAbortSignal,
  withAbort,
} from '../lib/fs-helpers.js';
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
  title: 'Apply Patch',
  description: 'Apply a unified patch to a file.',
  inputSchema: ApplyPatchInputSchema,
  outputSchema: ApplyPatchOutputSchema,
  annotations: {
    readOnlyHint: false,
    openWorldHint: false,
  },
} as const;

function assertPatchTargetSizeWithinLimit(
  filePath: string,
  size: number,
  maxFileSize: number
): void {
  if (size <= maxFileSize) return;
  throw new McpError(
    ErrorCode.E_TOO_LARGE,
    `File too large for patch: ${filePath} (${size} bytes > ${maxFileSize} bytes).`,
    filePath,
    { size, maxFileSize }
  );
}

function assertPatchHasHunks(patch: string): void {
  if (!patch.trim()) {
    throw new McpError(ErrorCode.E_INVALID_INPUT, 'Patch content is empty.');
  }
  const hasHunk = /@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/u.test(patch);
  if (!hasHunk) {
    throw new McpError(
      ErrorCode.E_INVALID_INPUT,
      'Patch must include unified hunk headers (e.g., @@ -1,2 +1,2 @@).'
    );
  }
}

async function handleApplyPatch(
  args: z.infer<typeof ApplyPatchInputSchema>,
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof ApplyPatchOutputSchema>>> {
  const maxFileSize = args.maxFileSize ?? MAX_TEXT_FILE_SIZE;
  const validPath = await validateExistingPath(args.path, signal);
  const stats = await withAbort(fs.stat(validPath), signal);
  assertPatchTargetSizeWithinLimit(validPath, stats.size, maxFileSize);
  const content = await fs.readFile(validPath, { encoding: 'utf-8', signal });

  const fuzzFactor = args.fuzzFactor ?? (args.fuzzy ? 2 : 0);

  assertPatchHasHunks(args.patch);

  const patched = applyPatch(content, args.patch, {
    fuzzFactor,
    autoConvertLineEndings: args.autoConvertLineEndings,
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
        return `🛠 apply_patch: ${name}`;
      },
    })
  );
}
