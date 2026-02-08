import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import {
  DEFAULT_SEARCH_TIMEOUT_MS,
  MAX_TEXT_FILE_SIZE,
} from '../lib/constants.js';
import { ErrorCode } from '../lib/errors.js';
import { readFile } from '../lib/fs-helpers.js';
import { createTimedAbortSignal } from '../lib/fs-helpers.js';
import { withToolDiagnostics } from '../lib/observability.js';
import { ReadFileInputSchema, ReadFileOutputSchema } from '../schemas.js';
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

const READ_FILE_TOOL = {
  title: 'Read File',
  description:
    'Read the text contents of a file. ' +
    'Use head parameter to preview the first N lines of large files. ' +
    'For multiple files, use read_many for efficiency.',
  inputSchema: ReadFileInputSchema,
  outputSchema: ReadFileOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

async function handleReadFile(
  args: z.infer<typeof ReadFileInputSchema>,
  signal?: AbortSignal,
  resourceStore?: ToolRegistrationOptions['resourceStore']
): Promise<ToolResponse<z.infer<typeof ReadFileOutputSchema>>> {
  const options: Parameters<typeof readFile>[1] = {
    encoding: 'utf-8',
    maxSize: MAX_TEXT_FILE_SIZE,
    skipBinary: true,
  };
  if (args.head !== undefined) {
    options.head = args.head;
  }
  if (args.startLine !== undefined) {
    options.startLine = args.startLine;
  }
  if (args.endLine !== undefined) {
    options.endLine = args.endLine;
  }
  if (signal) {
    options.signal = signal;
  }
  const result = await readFile(args.path, options);

  const structured: z.infer<typeof ReadFileOutputSchema> = {
    ok: true,
    path: args.path,
    content: result.content,
    truncated: result.truncated,
    resourceUri: undefined,
    totalLines: result.totalLines,
    readMode: result.readMode,
    head: result.head,
    startLine: result.startLine,
    endLine: result.endLine,
    linesRead: result.linesRead,
    hasMoreLines: result.hasMoreLines,
  };

  const externalized = maybeExternalizeTextContent(
    resourceStore,
    result.content,
    { name: `read:${path.basename(args.path)}`, mimeType: 'text/plain' }
  );
  if (!externalized) {
    return buildToolResponse(result.content, structured);
  }

  const { entry, preview } = externalized;
  const structuredWithResource: z.infer<typeof ReadFileOutputSchema> = {
    ...structured,
    content: preview,
    truncated: true,
    resourceUri: entry.uri,
  };

  const text = [
    `Output too large to inline (${result.content.length} chars).`,
    'Preview:',
    preview,
  ].join('\n');

  return buildToolResponse(text, structuredWithResource, [
    buildResourceLink({
      uri: entry.uri,
      name: entry.name,
      mimeType: entry.mimeType,
      description: 'Full file contents',
    }),
  ]);
}

export function registerReadFileTool(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  const handler = (
    args: z.infer<typeof ReadFileInputSchema>,
    extra: ToolExtra
  ): Promise<ToolResult<z.infer<typeof ReadFileOutputSchema>>> =>
    withToolDiagnostics(
      'read',
      () =>
        withToolErrorHandling(
          async () => {
            const { signal, cleanup } = createTimedAbortSignal(
              extra.signal,
              DEFAULT_SEARCH_TIMEOUT_MS
            );
            try {
              return await handleReadFile(args, signal, options.resourceStore);
            } finally {
              cleanup();
            }
          },
          (error) =>
            buildToolErrorResponse(error, ErrorCode.E_NOT_FILE, args.path)
        ),
      { path: args.path }
    );

  server.registerTool(
    'read',
    withDefaultIcons({ ...READ_FILE_TOOL }, options.iconInfo),
    wrapToolHandler(handler, {
      guard: options.isInitialized,
      progressMessage: (args) => {
        const name = path.basename(args.path);
        if (args.startLine !== undefined) {
          const end = args.endLine ?? '…';
          return `read | ${name} | ${args.startLine}-${end}`;
        }
        return `read | ${name}`;
      },
    })
  );
}
