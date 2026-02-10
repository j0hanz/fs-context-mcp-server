import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import { createTwoFilesPatch } from 'diff';

import { MAX_TEXT_FILE_SIZE } from '../lib/constants.js';
import { ErrorCode, McpError } from '../lib/errors.js';
import { createTimedAbortSignal, withAbort } from '../lib/fs-helpers.js';
import { withToolDiagnostics } from '../lib/observability.js';
import { validateExistingPath } from '../lib/path-validation.js';
import { DiffFilesInputSchema, DiffFilesOutputSchema } from '../schemas.js';
import {
  buildResourceLink,
  buildToolErrorResponse,
  buildToolResponse,
  maybeExternalizeTextContent,
  type ToolExtra,
  type ToolRegistrationOptions,
  type ToolResponse,
  type ToolResult,
  withDefaultIcons,
  withToolErrorHandling,
  wrapToolHandler,
} from './shared.js';

const DIFF_FILES_TOOL = {
  title: 'Diff Files',
  description: 'Generate a unified diff between two files.',
  inputSchema: DiffFilesInputSchema,
  outputSchema: DiffFilesOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

function assertDiffFileSizeWithinLimit(
  filePath: string,
  size: number,
  maxFileSize: number
): void {
  if (size <= maxFileSize) return;
  throw new McpError(
    ErrorCode.E_TOO_LARGE,
    `File too large for diff: ${filePath} (${size} bytes > ${maxFileSize} bytes).`,
    filePath,
    { size, maxFileSize }
  );
}

async function handleDiffFiles(
  args: z.infer<typeof DiffFilesInputSchema>,
  signal?: AbortSignal,
  resourceStore?: ToolRegistrationOptions['resourceStore']
): Promise<ToolResponse<z.infer<typeof DiffFilesOutputSchema>>> {
  const maxFileSize = args.maxFileSize ?? MAX_TEXT_FILE_SIZE;
  const [originalPath, modifiedPath] = await Promise.all([
    validateExistingPath(args.original, signal),
    validateExistingPath(args.modified, signal),
  ]);

  const [originalStats, modifiedStats] = await Promise.all([
    withAbort(fs.stat(originalPath), signal),
    withAbort(fs.stat(modifiedPath), signal),
  ]);

  assertDiffFileSizeWithinLimit(originalPath, originalStats.size, maxFileSize);
  assertDiffFileSizeWithinLimit(modifiedPath, modifiedStats.size, maxFileSize);

  const [originalContent, modifiedContent] = await Promise.all([
    fs.readFile(originalPath, { encoding: 'utf-8', signal }),
    fs.readFile(modifiedPath, { encoding: 'utf-8', signal }),
  ]);

  const patch = createTwoFilesPatch(
    path.basename(originalPath),
    path.basename(modifiedPath),
    originalContent,
    modifiedContent,
    undefined,
    undefined,
    {
      ...(args.context !== undefined ? { context: args.context } : {}),
      ignoreWhitespace: args.ignoreWhitespace,
      stripTrailingCr: args.stripTrailingCr,
    }
  );

  const externalized = maybeExternalizeTextContent(resourceStore, patch, {
    name: 'diff:patch',
    mimeType: 'text/x-diff',
  });

  if (!externalized) {
    return buildToolResponse(patch, {
      ok: true,
      diff: patch,
    });
  }

  const { preview, entry } = externalized;
  return buildToolResponse(
    preview,
    {
      ok: true,
      diff: preview,
      truncated: true,
      resourceUri: entry.uri,
    },
    [
      buildResourceLink({
        uri: entry.uri,
        name: entry.name,
        mimeType: entry.mimeType,
        description: 'Full diff content',
      }),
    ]
  );
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
              return await handleDiffFiles(args, signal, options.resourceStore);
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
        return `⇄ diff_files: ${name1} ↔ ${name2}`;
      },
    })
  );
}
