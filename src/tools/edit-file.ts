import * as fs from 'node:fs/promises';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import { ErrorCode, McpError } from '../lib/errors.js';
import { createTimedAbortSignal } from '../lib/fs-helpers.js';
import { withToolDiagnostics } from '../lib/observability.js';
import { validateExistingPath } from '../lib/path-validation.js';
import { EditFileInputSchema, EditFileOutputSchema } from '../schemas.js';
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

const EDIT_FILE_TOOL = {
  title: 'Edit File',
  description:
    'Edit a file by replacing text. Sequentially applies a list of string replacements. ' +
    'Replaces the first occurrence of each `oldText`.',
  inputSchema: EditFileInputSchema,
  outputSchema: EditFileOutputSchema,
} as const;

function applyEdits(
  content: string,
  edits: z.infer<typeof EditFileInputSchema>['edits']
): string {
  let newContent = content;
  for (const edit of edits) {
    if (!newContent.includes(edit.oldText)) {
      throw new McpError(
        ErrorCode.E_INVALID_INPUT,
        `Could not find text to replace: "${edit.oldText}"`
      );
    }
    newContent = newContent.replace(edit.oldText, edit.newText);
  }
  return newContent;
}

async function handleEditFile(
  args: z.infer<typeof EditFileInputSchema>,
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof EditFileOutputSchema>>> {
  const validPath = await validateExistingPath(args.path, signal);
  const content = await fs.readFile(validPath, 'utf-8');

  const newContent = applyEdits(content, args.edits);

  if (args.dryRun) {
    return buildToolResponse('Dry run successful. Edits would be applied.', {
      ok: true,
      path: validPath,
      appliedEdits: args.edits.length,
    });
  }

  await fs.writeFile(validPath, newContent, 'utf-8');

  return buildToolResponse(
    `Successfully applied ${args.edits.length} edits to ${args.path}`,
    {
      ok: true,
      path: validPath,
      appliedEdits: args.edits.length,
    }
  );
}

export function registerEditFileTool(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  const handler = (
    args: z.infer<typeof EditFileInputSchema>,
    extra: ToolExtra
  ): Promise<ToolResult<z.infer<typeof EditFileOutputSchema>>> =>
    withToolDiagnostics(
      'edit_file',
      () =>
        withToolErrorHandling(
          async () => {
            const { signal, cleanup } = createTimedAbortSignal(extra.signal);
            try {
              return await handleEditFile(args, signal);
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
    'edit_file',
    withDefaultIcons({ ...EDIT_FILE_TOOL }, options.iconInfo),
    wrapToolHandler(handler, {
      guard: options.isInitialized,
    })
  );
}
