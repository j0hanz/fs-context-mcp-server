import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import {
  DEFAULT_EXCLUDE_PATTERNS,
  DEFAULT_SEARCH_MAX_FILES,
  DEFAULT_SEARCH_TIMEOUT_MS,
  MAX_SEARCHABLE_FILE_SIZE,
} from '../lib/constants.js';
import { ErrorCode } from '../lib/errors.js';
import { searchContent } from '../lib/file-operations/search/engine.js';
import { createTimedAbortSignal } from '../lib/fs-helpers/abort.js';
import { withToolDiagnostics } from '../lib/observability/diagnostics.js';
import { getAllowedDirectories } from '../lib/path-validation/allowed-directories.js';
import {
  SearchContentInputSchema,
  SearchContentOutputSchema,
} from '../schemas/index.js';
import {
  buildStructuredResult,
  buildTextResult,
} from './shared/search-formatting.js';
import {
  buildToolErrorResponse,
  buildToolResponse,
  type ToolResponse,
  type ToolResult,
  withToolErrorHandling,
} from './tool-response.js';

type SearchContentArgs = z.infer<typeof SearchContentInputSchema>;
type SearchContentStructuredResult = z.infer<typeof SearchContentOutputSchema>;

function resolvePathOrRoot(path: string | undefined): string {
  if (path && path.trim().length > 0) return path;
  const firstRoot = getAllowedDirectories()[0];
  if (!firstRoot) {
    throw new Error('No workspace roots configured. Use roots to check.');
  }
  return firstRoot;
}

async function handleSearchContent(
  args: SearchContentArgs,
  signal?: AbortSignal
): Promise<ToolResponse<SearchContentStructuredResult>> {
  const basePath = resolvePathOrRoot(args.path);
  const fullOptions = {
    filePattern: args.filePattern,
    excludePatterns: args.includeIgnored ? [] : DEFAULT_EXCLUDE_PATTERNS,
    caseSensitive: false,
    isLiteral: true,
    contextLines: 0,
    maxFileSize: MAX_SEARCHABLE_FILE_SIZE,
    maxFilesScanned: DEFAULT_SEARCH_MAX_FILES,
    timeoutMs: DEFAULT_SEARCH_TIMEOUT_MS,
    skipBinary: true,
    includeHidden: args.includeIgnored,
    wholeWord: false,
    baseNameMatch: false,
    caseSensitiveFileMatch: true,
    signal,
  };

  const result = await searchContent(basePath, args.pattern, fullOptions);

  const structured = buildStructuredResult(result);

  return buildToolResponse(buildTextResult(result), structured);
}

const SEARCH_CONTENT_TOOL = {
  title: 'Search Content',
  description:
    'Search for text within file contents (grep-like). ' +
    'Returns matching lines. ' +
    'Use includeIgnored=true to search in node_modules/dist for debugging.',
  inputSchema: SearchContentInputSchema,
  outputSchema: SearchContentOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
} as const;

export function registerSearchContentTool(server: McpServer): void {
  const handler = (
    args: SearchContentArgs,
    extra: { signal: AbortSignal }
  ): Promise<ToolResult<SearchContentStructuredResult>> =>
    withToolDiagnostics(
      'grep',
      () =>
        withToolErrorHandling(
          async () => {
            const { signal, cleanup } = createTimedAbortSignal(
              extra.signal,
              DEFAULT_SEARCH_TIMEOUT_MS
            );
            try {
              return await handleSearchContent(args, signal);
            } finally {
              cleanup();
            }
          },
          (error) =>
            buildToolErrorResponse(error, ErrorCode.E_UNKNOWN, args.path ?? '.')
        ),
      { path: args.path ?? '.' }
    );

  server.registerTool('grep', SEARCH_CONTENT_TOOL, handler);
}
