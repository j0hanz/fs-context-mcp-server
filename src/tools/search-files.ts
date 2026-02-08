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
import { createTimedAbortSignal } from '../lib/fs-helpers.js';
import { withToolDiagnostics } from '../lib/observability.js';
import { SearchFilesInputSchema, SearchFilesOutputSchema } from '../schemas.js';
import {
  buildToolErrorResponse,
  buildToolResponse,
  resolvePathOrRoot,
  type ToolExtra,
  type ToolRegistrationOptions,
  type ToolResponse,
  type ToolResult,
  withToolErrorHandling,
  wrapToolHandler,
} from './shared.js';

const SEARCH_FILES_TOOL = {
  title: 'Find Files',
  description:
    'Find files by glob pattern (e.g., **/*.ts). ' +
    'Returns a list of matching files with metadata. ' +
    'For text search inside files, use grep.',
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
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof SearchFilesOutputSchema>>> {
  const basePath = resolvePathOrRoot(args.path);
  const excludePatterns = args.includeIgnored ? [] : DEFAULT_EXCLUDE_PATTERNS;
  const result = await searchFiles(basePath, args.pattern, excludePatterns, {
    maxResults: args.maxResults,
    respectGitignore: !args.includeIgnored,
    ...(signal ? { signal } : {}),
  });
  const relativeResults = result.results.map((entry) => ({
    path: path.relative(result.basePath, entry.path),
    size: entry.size,
    modified: entry.modified?.toISOString(),
  }));
  const structured: z.infer<typeof SearchFilesOutputSchema> = {
    ok: true,
    results: relativeResults,
    totalMatches: result.summary.matched,
    truncated: result.summary.truncated,
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
    withToolDiagnostics(
      'find',
      () =>
        withToolErrorHandling(
          async () => {
            const { signal, cleanup } = createTimedAbortSignal(
              extra.signal,
              DEFAULT_SEARCH_TIMEOUT_MS
            );
            try {
              return await handleSearchFiles(args, signal);
            } finally {
              cleanup();
            }
          },
          (error) =>
            buildToolErrorResponse(
              error,
              ErrorCode.E_INVALID_PATTERN,
              args.path
            )
        ),
      { path: args.path ?? '.' }
    );

  server.registerTool(
    'find',
    {
      ...SEARCH_FILES_TOOL,
      ...(options.iconInfo
        ? {
            icons: [
              {
                src: options.iconInfo.src,
                mimeType: options.iconInfo.mimeType,
                ...(options.iconInfo.mimeType === 'image/svg+xml'
                  ? { sizes: ['any'] }
                  : {}),
              },
            ],
          }
        : {}),
    },
    wrapToolHandler(handler, {
      guard: options.isInitialized,
      progressMessage: (args) => `find ${args.pattern}`,
    })
  );
}
