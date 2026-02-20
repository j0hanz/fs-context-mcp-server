import * as path from 'node:path';

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
  type ToolContract,
  type ToolExtra,
  type ToolRegistrationOptions,
  type ToolResponse,
  type ToolResult,
  withDefaultIcons,
  withValidatedArgs,
  wrapToolHandler,
} from './shared.js';
import { registerToolTaskIfAvailable } from './task-support.js';

export const GET_MULTIPLE_FILE_INFO_TOOL: ToolContract = {
  name: 'stat_many',
  title: 'Get Multiple File Info',
  description: 'Get metadata for multiple files or directories in one request.',
  inputSchema: GetMultipleFileInfoInputSchema,
  outputSchema: GetMultipleFileInfoOutputSchema,
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
  nuances: ['Use before read/search when file size/type uncertainty exists.'],
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
    progressMessage: (args) => {
      const first = path.basename(args.paths[0] ?? '');
      const extra =
        args.paths.length > 1 ? `, ${path.basename(args.paths[1] ?? '')}…` : '';
      return `🕮 stat_many: ${args.paths.length} paths [${first}${extra}]`;
    },
    completionMessage: (args, result) => {
      if (result.isError)
        return `🕮 stat_many: ${args.paths.length} paths • failed`;
      const sc = result.structuredContent;
      if (!sc.ok) return `🕮 stat_many: ${args.paths.length} paths • failed`;
      const total = sc.summary?.total ?? 0;
      const succeeded = sc.summary?.succeeded ?? 0;
      const failed = sc.summary?.failed ?? 0;
      if (failed)
        return `🕮 stat_many: ${succeeded}/${total} OK, ${failed} failed`;
      return `🕮 stat_many: ${total} OK`;
    },
  });

  const validatedHandler = withValidatedArgs(
    GetMultipleFileInfoInputSchema,
    wrappedHandler
  );

  if (
    registerToolTaskIfAvailable(
      server,
      'stat_many',
      GET_MULTIPLE_FILE_INFO_TOOL,
      validatedHandler,
      options.iconInfo,
      options.isInitialized
    )
  )
    return;
  server.registerTool(
    'stat_many',
    withDefaultIcons({ ...GET_MULTIPLE_FILE_INFO_TOOL }, options.iconInfo),
    validatedHandler
  );
}
