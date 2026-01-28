import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import { formatOperationSummary, joinLines } from '../config.js';
import { DEFAULT_EXCLUDE_PATTERNS } from '../lib/constants.js';
import { ErrorCode } from '../lib/errors.js';
import { listDirectory } from '../lib/file-operations/list-directory.js';
import { withToolDiagnostics } from '../lib/observability.js';
import {
  ListDirectoryInputSchema,
  ListDirectoryOutputSchema,
} from '../schemas.js';
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

const LIST_DIRECTORY_TOOL = {
  title: 'List Directory',
  description:
    'List the immediate contents of a directory (non-recursive). ' +
    'Returns name, relative path, type (file/directory/symlink), size, and modified date. ' +
    'Omit path to list the workspace root. ' +
    'Use includeIgnored=true to include ignored directories like node_modules. ' +
    'For recursive searches, use find instead.',
  inputSchema: ListDirectoryInputSchema,
  outputSchema: ListDirectoryOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

function buildListTextResult(
  result: Awaited<ReturnType<typeof listDirectory>>
): string {
  const { entries, summary, path } = result;
  if (entries.length === 0) {
    if (!summary.entriesScanned || summary.entriesScanned === 0) {
      return `${path} (empty)`;
    }
    return `${path} (no matches)`;
  }

  const lines = [
    path,
    ...entries.map((entry) => {
      const suffix = entry.type === 'directory' ? '/' : '';
      return `  ${entry.relativePath}${suffix}`;
    }),
  ];

  let truncatedReason: string | undefined;
  if (summary.truncated) {
    if (summary.stoppedReason === 'maxEntries') {
      truncatedReason = `max entries (${summary.totalEntries})`;
    } else {
      truncatedReason = 'aborted';
    }
  }

  const summaryOptions: Parameters<typeof formatOperationSummary>[0] = {
    truncated: summary.truncated,
    ...(truncatedReason ? { truncatedReason } : {}),
  };

  return joinLines(lines) + formatOperationSummary(summaryOptions);
}

function buildStructuredListEntry(
  entry: Awaited<ReturnType<typeof listDirectory>>['entries'][number]
): NonNullable<z.infer<typeof ListDirectoryOutputSchema>['entries']>[number] {
  return {
    name: entry.name,
    relativePath: entry.relativePath,
    type: entry.type,
    size: entry.size,
    modified: entry.modified?.toISOString(),
  };
}

function buildStructuredListResult(
  result: Awaited<ReturnType<typeof listDirectory>>
): z.infer<typeof ListDirectoryOutputSchema> {
  const { entries, summary, path: resultPath } = result;
  return {
    ok: true,
    path: resultPath,
    entries: entries.map(buildStructuredListEntry),
    totalEntries: summary.totalEntries,
  };
}

async function handleListDirectory(
  args: z.infer<typeof ListDirectoryInputSchema>,
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof ListDirectoryOutputSchema>>> {
  const dirPath = resolvePathOrRoot(args.path);
  const options: Parameters<typeof listDirectory>[1] = {
    includeHidden: args.includeHidden,
    excludePatterns: args.includeIgnored ? [] : DEFAULT_EXCLUDE_PATTERNS,
    ...(signal ? { signal } : {}),
  };
  const result = await listDirectory(dirPath, options);
  return buildToolResponse(
    buildListTextResult(result),
    buildStructuredListResult(result)
  );
}

export function registerListDirectoryTool(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  const handler = (
    args: z.infer<typeof ListDirectoryInputSchema>,
    extra: ToolExtra
  ): Promise<ToolResult<z.infer<typeof ListDirectoryOutputSchema>>> =>
    withToolDiagnostics(
      'ls',
      () =>
        withToolErrorHandling(
          () => handleListDirectory(args, extra.signal),
          (error) =>
            buildToolErrorResponse(
              error,
              ErrorCode.E_NOT_DIRECTORY,
              args.path ?? '.'
            )
        ),
      { path: args.path ?? '.' }
    );

  server.registerTool(
    'ls',
    LIST_DIRECTORY_TOOL,
    wrapToolHandler(handler, { guard: options.isInitialized })
  );
}
