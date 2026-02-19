import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import {
  DEFAULT_READ_MANY_MAX_TOTAL_SIZE,
  DEFAULT_SEARCH_TIMEOUT_MS,
} from '../lib/constants.js';
import { ErrorCode } from '../lib/errors.js';
import { readMultipleFiles } from '../lib/file-operations/read-multiple-files.js';
import {
  ReadMultipleFilesInputSchema,
  ReadMultipleFilesOutputSchema,
} from '../schemas.js';
import {
  buildResourceLink,
  buildToolErrorResponse,
  buildToolResponse,
  executeToolWithDiagnostics,
  maybeExternalizeTextContent,
  type ToolExtra,
  type ToolRegistrationOptions,
  type ToolResponse,
  type ToolResult,
  withDefaultIcons,
  wrapToolHandler,
} from './shared.js';
import { createToolTaskHandler, tryRegisterToolTask } from './task-support.js';

const READ_MULTIPLE_FILES_TOOL = {
  title: 'Read Multiple Files',
  description:
    'Read multiple text files in a single request. ' +
    'Returns contents and metadata for each file. ' +
    'For single file, use read for simpler output.',
  inputSchema: ReadMultipleFilesInputSchema,
  outputSchema: ReadMultipleFilesOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

async function handleReadMultipleFiles(
  args: z.infer<typeof ReadMultipleFilesInputSchema>,
  signal?: AbortSignal,
  resourceStore?: ToolRegistrationOptions['resourceStore']
): Promise<ToolResponse<z.infer<typeof ReadMultipleFilesOutputSchema>>> {
  const options: Parameters<typeof readMultipleFiles>[1] = {
    ...(signal ? { signal } : {}),
    ...(args.head !== undefined ? { head: args.head } : {}),
    ...(args.startLine !== undefined ? { startLine: args.startLine } : {}),
    ...(args.endLine !== undefined ? { endLine: args.endLine } : {}),
  };
  const results = await readMultipleFiles(args.paths, options);

  const maxTotalSize = DEFAULT_READ_MANY_MAX_TOTAL_SIZE;

  type ReadManyResult = Awaited<ReturnType<typeof readMultipleFiles>>[number];
  type ReadManyResultWithResource = ReadManyResult & {
    resourceUri?: string;
    truncationReason?: 'head' | 'range' | 'externalized';
    maxTotalSize?: number;
  };

  const mappedResults: ReadManyResultWithResource[] = results.map((result) => {
    let baseTruncationReason: 'head' | 'range' | undefined;
    if (result.truncated && result.readMode === 'head') {
      baseTruncationReason = 'head';
    } else if (result.truncated && result.readMode === 'range') {
      baseTruncationReason = 'range';
    }

    const baseResult: ReadManyResultWithResource = {
      ...result,
      maxTotalSize,
      ...(baseTruncationReason
        ? { truncationReason: baseTruncationReason }
        : {}),
    };

    if (!result.content) {
      return baseResult;
    }

    const externalized = maybeExternalizeTextContent(
      resourceStore,
      result.content,
      { name: `read:${path.basename(result.path)}`, mimeType: 'text/plain' }
    );
    if (!externalized) {
      return baseResult;
    }

    return {
      ...baseResult,
      content: externalized.preview,
      truncated: true,
      resourceUri: externalized.entry.uri,
      truncationReason: 'externalized',
    };
  });

  let succeeded = 0;
  let failed = 0;
  for (const result of mappedResults) {
    if (result.error === undefined) succeeded += 1;
    else failed += 1;
  }

  const structured: z.infer<typeof ReadMultipleFilesOutputSchema> = {
    ok: true,
    results: mappedResults.map((result) => ({
      path: result.path,
      content: result.content,
      truncated: result.truncated,
      resourceUri: result.resourceUri,
      readMode: result.readMode,
      head: result.head,
      startLine: result.startLine,
      endLine: result.endLine,
      linesRead: result.linesRead,
      hasMoreLines: result.hasMoreLines,
      totalLines: result.totalLines,
      truncationReason: result.truncationReason,
      maxTotalSize: result.maxTotalSize,
      error: result.error,
    })),
    summary: {
      total: mappedResults.length,
      succeeded,
      failed,
    },
  };

  const resourceLinks: ReturnType<typeof buildResourceLink>[] = [];
  for (const result of mappedResults) {
    if (!result.resourceUri) continue;
    resourceLinks.push(
      buildResourceLink({
        uri: result.resourceUri,
        name: `read:${path.basename(result.path)}`,
        description: 'Full file contents',
      })
    );
  }

  const text = mappedResults
    .map((result) => {
      if (result.error) {
        return `${result.path}: ${result.error}`;
      }
      return result.path;
    })
    .join('\n');

  return buildToolResponse(text, structured, resourceLinks, resourceStore);
}

export function registerReadMultipleFilesTool(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  const handler = (
    args: z.infer<typeof ReadMultipleFilesInputSchema>,
    extra: ToolExtra
  ): Promise<ToolResult<z.infer<typeof ReadMultipleFilesOutputSchema>>> => {
    const primaryPath = args.paths[0] ?? '';
    return executeToolWithDiagnostics({
      toolName: 'read_many',
      extra,
      timedSignal: { timeoutMs: DEFAULT_SEARCH_TIMEOUT_MS },
      context: { path: primaryPath },
      run: (signal) =>
        handleReadMultipleFiles(args, signal, options.resourceStore),
      onError: (error) =>
        buildToolErrorResponse(error, ErrorCode.E_NOT_FILE, primaryPath),
    });
  };

  const wrappedHandler = wrapToolHandler(handler, {
    guard: options.isInitialized,
    progressMessage: (args) => `🕮 read_many: ${args.paths.length} files`,
  });

  const taskOptions = options.isInitialized
    ? { guard: options.isInitialized }
    : undefined;

  if (
    tryRegisterToolTask(
      server,
      'read_many',
      READ_MULTIPLE_FILES_TOOL,
      createToolTaskHandler(wrappedHandler, taskOptions),
      options.iconInfo
    )
  )
    return;
  server.registerTool(
    'read_many',
    withDefaultIcons({ ...READ_MULTIPLE_FILES_TOOL }, options.iconInfo),
    wrappedHandler
  );
}
