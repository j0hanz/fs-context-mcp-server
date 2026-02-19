import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import { formatBytes, joinLines } from '../config.js';
import type { FileInfo } from '../config.js';
import { DEFAULT_SEARCH_TIMEOUT_MS } from '../lib/constants.js';
import { ErrorCode } from '../lib/errors.js';
import { getMultipleFileInfo } from '../lib/file-operations/file-info.js';
import {
  GetMultipleFileInfoInputSchema,
  GetMultipleFileInfoOutputSchema,
} from '../schemas.js';
import {
  buildFileInfoPayload,
  buildToolErrorResponse,
  buildToolResponse,
  executeToolWithDiagnostics,
  READ_ONLY_TOOL_ANNOTATIONS,
  type ToolExtra,
  type ToolRegistrationOptions,
  type ToolResponse,
  type ToolResult,
  withDefaultIcons,
  wrapToolHandler,
} from './shared.js';
import { registerToolTaskIfAvailable } from './task-support.js';

const GET_MULTIPLE_FILE_INFO_TOOL = {
  title: 'Get Multiple File Info',
  description: 'Get metadata for multiple files or directories in one request.',
  inputSchema: GetMultipleFileInfoInputSchema,
  outputSchema: GetMultipleFileInfoOutputSchema,
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
} as const;

function formatFileInfoDetail(info: FileInfo): string {
  const lines = [
    `${info.name} (${info.type})`,
    `  Path: ${info.path}`,
    `  Size: ${formatBytes(info.size)}`,
    `  Modified: ${info.modified.toISOString()}`,
  ];
  if (info.mimeType) lines.push(`  Type: ${info.mimeType}`);
  if (info.symlinkTarget) lines.push(`  Target: ${info.symlinkTarget}`);
  return joinLines(lines);
}

async function handleGetMultipleFileInfo(
  args: z.infer<typeof GetMultipleFileInfoInputSchema>,
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof GetMultipleFileInfoOutputSchema>>> {
  const result = await getMultipleFileInfo(args.paths, {
    includeMimeType: true,
    ...(signal ? { signal } : {}),
  });

  const structuredResults: z.infer<
    typeof GetMultipleFileInfoOutputSchema
  >['results'] = [];
  const textBlocks: string[] = [];
  for (const entry of result.results) {
    structuredResults.push({
      path: entry.path,
      info: entry.info ? buildFileInfoPayload(entry.info) : undefined,
      error: entry.error,
    });
    if (entry.error) {
      textBlocks.push(`${entry.path}: ${entry.error}`);
    } else if (entry.info) {
      textBlocks.push(formatFileInfoDetail(entry.info));
    } else {
      textBlocks.push(entry.path);
    }
  }

  const structured: z.infer<typeof GetMultipleFileInfoOutputSchema> = {
    ok: true,
    results: structuredResults,
    summary: {
      total: result.summary.total,
      succeeded: result.summary.succeeded,
      failed: result.summary.failed,
    },
  };

  const text = textBlocks.join('\n\n');

  return buildToolResponse(text, structured);
}

export function registerGetMultipleFileInfoTool(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  const handler = (
    args: z.infer<typeof GetMultipleFileInfoInputSchema>,
    extra: ToolExtra
  ): Promise<ToolResult<z.infer<typeof GetMultipleFileInfoOutputSchema>>> => {
    const primaryPath = args.paths[0] ?? '';
    return executeToolWithDiagnostics({
      toolName: 'stat_many',
      extra,
      timedSignal: { timeoutMs: DEFAULT_SEARCH_TIMEOUT_MS },
      context: { path: primaryPath },
      run: (signal) => handleGetMultipleFileInfo(args, signal),
      onError: (error) =>
        buildToolErrorResponse(error, ErrorCode.E_NOT_FOUND, primaryPath),
    });
  };

  const wrappedHandler = wrapToolHandler(handler, {
    guard: options.isInitialized,
    progressMessage: (args) => `🕮 stat_many: ${args.paths.length} paths`,
  });

  if (
    registerToolTaskIfAvailable(
      server,
      'stat_many',
      GET_MULTIPLE_FILE_INFO_TOOL,
      wrappedHandler,
      options.iconInfo,
      options.isInitialized
    )
  )
    return;
  server.registerTool(
    'stat_many',
    withDefaultIcons({ ...GET_MULTIPLE_FILE_INFO_TOOL }, options.iconInfo),
    wrappedHandler
  );
}
