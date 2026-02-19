import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import { formatOperationSummary, joinLines } from '../config.js';
import {
  DEFAULT_EXCLUDE_PATTERNS,
  DEFAULT_SEARCH_TIMEOUT_MS,
} from '../lib/constants.js';
import { ErrorCode } from '../lib/errors.js';
import { searchFiles } from '../lib/file-operations/search-files.js';
import { SearchFilesInputSchema, SearchFilesOutputSchema } from '../schemas.js';
import {
  buildToolErrorResponse,
  buildToolResponse,
  createProgressReporter,
  executeToolWithDiagnostics,
  notifyProgress,
  resolvePathOrRoot,
  type ToolExtra,
  type ToolRegistrationOptions,
  type ToolResponse,
  type ToolResult,
  withDefaultIcons,
  wrapToolHandler,
} from './shared.js';
import { createToolTaskHandler, tryRegisterToolTask } from './task-support.js';

const SEARCH_FILES_TOOL = {
  title: 'Find Files',
  description:
    'Find files by glob pattern (e.g., **/*.ts). ' +
    'Returns a list of matching files with metadata. ' +
    'For text search inside files, use grep. ' +
    'To bulk-edit the matched files, pass the same glob pattern to search_and_replace.',
  inputSchema: SearchFilesInputSchema,
  outputSchema: SearchFilesOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

async function handleSearchFiles(
  args: z.infer<typeof SearchFilesInputSchema>,
  signal?: AbortSignal,
  onProgress?: (progress: { total?: number; current: number }) => void
): Promise<ToolResponse<z.infer<typeof SearchFilesOutputSchema>>> {
  const basePath = resolvePathOrRoot(args.path);
  const excludePatterns = args.includeIgnored ? [] : DEFAULT_EXCLUDE_PATTERNS;
  const searchOptions: Parameters<typeof searchFiles>[3] = {
    maxResults: args.maxResults,
    includeHidden: args.includeHidden,
    sortBy: args.sortBy,
    respectGitignore: !args.includeIgnored,
    ...(args.maxDepth !== undefined ? { maxDepth: args.maxDepth } : {}),
    ...(onProgress ? { onProgress } : {}),
    ...(signal ? { signal } : {}),
  };
  const result = await searchFiles(
    basePath,
    args.pattern,
    excludePatterns,
    searchOptions
  );
  const relativeResults = result.results.map((entry) => ({
    path: path.relative(result.basePath, entry.path),
    size: entry.size,
    modified: entry.modified?.toISOString(),
  }));
  const structured: z.infer<typeof SearchFilesOutputSchema> = {
    ok: true,
    root: basePath,
    pattern: args.pattern,
    results: relativeResults,
    totalMatches: result.summary.matched,
    truncated: result.summary.truncated,
    filesScanned: result.summary.filesScanned,
    skippedInaccessible: result.summary.skippedInaccessible,
    ...(result.summary.stoppedReason
      ? { stoppedReason: result.summary.stoppedReason }
      : {}),
  };

  let truncatedReason: string | undefined;
  if (result.summary.truncated) {
    if (result.summary.stoppedReason === 'timeout') {
      truncatedReason = 'timeout';
    } else if (result.summary.stoppedReason === 'maxFiles') {
      truncatedReason = `max files (${result.summary.filesScanned})`;
    } else {
      truncatedReason = `max results (${result.summary.matched})`;
    }
  }

  const summaryOptions: Parameters<typeof formatOperationSummary>[0] = {
    truncated: result.summary.truncated,
    ...(truncatedReason ? { truncatedReason } : {}),
  };

  const textLines =
    relativeResults.length === 0
      ? ['No matches']
      : [
          `Found ${relativeResults.length}:`,
          ...relativeResults.map((entry) => `  ${entry.path}`),
        ];

  const text = joinLines(textLines) + formatOperationSummary(summaryOptions);
  return buildToolResponse(text, structured);
}

export function registerSearchFilesTool(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  const handler = (
    args: z.infer<typeof SearchFilesInputSchema>,
    extra: ToolExtra
  ): Promise<ToolResult<z.infer<typeof SearchFilesOutputSchema>>> =>
    executeToolWithDiagnostics({
      toolName: 'find',
      extra,
      timedSignal: { timeoutMs: DEFAULT_SEARCH_TIMEOUT_MS },
      context: { path: args.path ?? '.' },
      run: async (signal) => {
        notifyProgress(extra, {
          current: 0,
          message: `🔎︎ find: ${args.pattern}`,
        });

        const result = await handleSearchFiles(
          args,
          signal,
          createProgressReporter(extra)
        );
        const sc = result.structuredContent;
        const suffix =
          sc.ok && sc.totalMatches ? String(sc.totalMatches) : 'No matches';
        const finalCurrent = (sc.filesScanned ?? 0) + 1;

        notifyProgress(extra, {
          current: finalCurrent,
          message: `🔎︎ find: ${args.pattern} ➟ ${suffix}`,
        });
        return result;
      },
      onError: (error) =>
        buildToolErrorResponse(error, ErrorCode.E_INVALID_PATTERN, args.path),
    });

  const { isInitialized } = options;

  const wrappedHandler = wrapToolHandler(handler, {
    guard: isInitialized,
  });
  const taskOptions = isInitialized ? { guard: isInitialized } : undefined;

  if (
    tryRegisterToolTask(
      server,
      'find',
      SEARCH_FILES_TOOL,
      createToolTaskHandler(wrappedHandler, taskOptions),
      options.iconInfo
    )
  )
    return;
  server.registerTool(
    'find',
    withDefaultIcons({ ...SEARCH_FILES_TOOL }, options.iconInfo),
    wrappedHandler
  );
}
