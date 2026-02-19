import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import { formatBytes } from '../config.js';
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
  getExperimentalTaskRegistration,
  type ToolExtra,
  type ToolRegistrationOptions,
  type ToolResponse,
  type ToolResult,
  withDefaultIcons,
  wrapToolHandler,
} from './shared.js';
import { createToolTaskHandler } from './task-support.js';

const GET_MULTIPLE_FILE_INFO_TOOL = {
  title: 'Get Multiple File Info',
  description: 'Get metadata for multiple files or directories in one request.',
  inputSchema: GetMultipleFileInfoInputSchema,
  outputSchema: GetMultipleFileInfoOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

function formatFileInfoSummary(pathValue: string, info: FileInfo): string {
  return `${pathValue} (${info.type}, ${formatBytes(info.size)})`;
}

async function handleGetMultipleFileInfo(
  args: z.infer<typeof GetMultipleFileInfoInputSchema>,
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof GetMultipleFileInfoOutputSchema>>> {
  const result = await getMultipleFileInfo(args.paths, {
    includeMimeType: true,
    ...(signal ? { signal } : {}),
  });

  const structured: z.infer<typeof GetMultipleFileInfoOutputSchema> = {
    ok: true,
    results: result.results.map((entry) => ({
      path: entry.path,
      info: entry.info ? buildFileInfoPayload(entry.info) : undefined,
      error: entry.error,
    })),
    summary: {
      total: result.summary.total,
      succeeded: result.summary.succeeded,
      failed: result.summary.failed,
    },
  };

  const text = result.results
    .map((entry) => {
      if (entry.error) {
        return `${entry.path}: ${entry.error}`;
      }
      if (entry.info) {
        return formatFileInfoSummary(entry.path, entry.info);
      }
      return entry.path;
    })
    .join('\n');

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

  const taskOptions = options.isInitialized
    ? { guard: options.isInitialized }
    : undefined;

  const tasks = getExperimentalTaskRegistration(server);

  if (tasks?.registerToolTask) {
    tasks.registerToolTask(
      'stat_many',
      withDefaultIcons(
        {
          ...GET_MULTIPLE_FILE_INFO_TOOL,
          execution: { taskSupport: 'optional' },
        },
        options.iconInfo
      ),
      createToolTaskHandler(wrappedHandler, taskOptions)
    );
    return;
  }

  server.registerTool(
    'stat_many',
    withDefaultIcons({ ...GET_MULTIPLE_FILE_INFO_TOOL }, options.iconInfo),
    wrappedHandler
  );
}
