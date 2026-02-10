import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import { ErrorCode } from '../lib/errors.js';
import { atomicWriteFile, createTimedAbortSignal } from '../lib/fs-helpers.js';
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
  annotations: {
    readOnlyHint: false,
    openWorldHint: false,
  },
} as const;

interface EditResult {
  content: string;
  appliedEdits: number;
  unmatchedEdits: string[];
}

function applyEdits(
  content: string,
  edits: z.infer<typeof EditFileInputSchema>['edits']
): EditResult {
  let newContent = content;
  let appliedEdits = 0;
  const unmatchedEdits: string[] = [];

  for (const edit of edits) {
    if (!newContent.includes(edit.oldText)) {
      unmatchedEdits.push(edit.oldText);
      continue;
    }
    newContent = newContent.replace(edit.oldText, edit.newText);
    appliedEdits += 1;
  }

  return { content: newContent, appliedEdits, unmatchedEdits };
}

async function handleEditFile(
  args: z.infer<typeof EditFileInputSchema>,
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof EditFileOutputSchema>>> {
  const validPath = await validateExistingPath(args.path, signal);
  const content = await fs.readFile(validPath, { encoding: 'utf-8', signal });

  const {
    content: newContent,
    appliedEdits,
    unmatchedEdits,
  } = applyEdits(content, args.edits);

  const structured = {
    ok: true,
    path: validPath,
    appliedEdits,
    ...(unmatchedEdits.length > 0 ? { unmatchedEdits } : {}),
  };

  if (args.dryRun) {
    return buildToolResponse(
      `Dry run complete. ${appliedEdits} edits would be applied.`,
      structured
    );
  }

  if (appliedEdits > 0) {
    await atomicWriteFile(validPath, newContent, { encoding: 'utf-8', signal });
  }

  const message =
    appliedEdits === 0
      ? `No edits applied to ${args.path}`
      : `Successfully applied ${appliedEdits} edits to ${args.path}`;

  return buildToolResponse(message, structured);
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
      'edit',
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
    'edit',
    withDefaultIcons({ ...EDIT_FILE_TOOL }, options.iconInfo),
    wrapToolHandler(handler, {
      guard: options.isInitialized,
      progressMessage: (args) => {
        const name = path.basename(args.path);
        return `🛠 edit: ${name} (${args.edits.length} edits)`;
      },
    })
  );
}
