import * as fs from 'node:fs/promises';
import safeRegex from 'safe-regex2';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';

import { ErrorCode, McpError } from '../lib/errors.js';
import { globEntries } from '../lib/file-operations/glob-engine.js';
import { atomicWriteFile, createTimedAbortSignal } from '../lib/fs-helpers.js';
import { withToolDiagnostics } from '../lib/observability.js';
import { validateExistingPath } from '../lib/path-validation.js';
import {
  SearchAndReplaceInputSchema,
  SearchAndReplaceOutputSchema,
} from '../schemas.js';
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

const SEARCH_AND_REPLACE_TOOL = {
  name: 'search_and_replace',
  description: 'Search and replace text across multiple files.',
  inputSchema: SearchAndReplaceInputSchema,
  outputSchema: SearchAndReplaceOutputSchema,
} as const;

async function processFile(
  filePath: string,
  args: z.infer<typeof SearchAndReplaceInputSchema>,
  signal?: AbortSignal
): Promise<{ matches: number; changed: boolean }> {
  try {
    const content = await fs.readFile(filePath, {
      encoding: 'utf-8',
      signal,
    });
    let newContent = content;
    let matchCount = 0;

    if (args.isRegex) {
      const regex = new RegExp(args.searchPattern, 'g');
      const matches = content.match(regex);
      matchCount = matches ? matches.length : 0;
      if (matchCount > 0) {
        newContent = content.replace(regex, args.replacement);
      }
    } else {
      let pos = content.indexOf(args.searchPattern);
      while (pos !== -1) {
        matchCount++;
        pos = content.indexOf(
          args.searchPattern,
          pos + args.searchPattern.length
        );
      }
      if (matchCount > 0) {
        newContent = content.replaceAll(args.searchPattern, args.replacement);
      }
    }

    if (matchCount > 0 && !args.dryRun) {
      await atomicWriteFile(filePath, newContent, {
        encoding: 'utf-8',
        signal,
      });
    }

    return { matches: matchCount, changed: matchCount > 0 };
  } catch {
    // Ignore read/write errors for individual files
    return { matches: 0, changed: false };
  }
}

async function handleSearchAndReplace(
  args: z.infer<typeof SearchAndReplaceInputSchema>,
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof SearchAndReplaceOutputSchema>>> {
  const root = args.path
    ? await validateExistingPath(args.path, signal)
    : process.cwd();

  if (args.isRegex) {
    if (!safeRegex(args.searchPattern)) {
      throw new McpError(
        ErrorCode.E_INVALID_INPUT,
        `Unsafe regex pattern: ${args.searchPattern}`
      );
    }
  }

  const entries = globEntries({
    cwd: root,
    pattern: args.filePattern,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    excludePatterns: args.excludePatterns ?? [],
    includeHidden: false,
    baseNameMatch: false,
    caseSensitiveMatch: true, // Default to sensitive for file paths
    followSymbolicLinks: false,
    onlyFiles: true,
    stats: false,
    suppressErrors: true,
  });

  let totalMatches = 0;
  let filesChanged = 0;

  for await (const entry of entries) {
    if (signal?.aborted) break;

    const result = await processFile(entry.path, args, signal);
    if (result.matches > 0) {
      totalMatches += result.matches;
      filesChanged++;
    }
  }

  return buildToolResponse(
    `Found ${totalMatches} matches in ${filesChanged} files.${args.dryRun ? ' (Dry run)' : ''}`,
    {
      ok: true,
      matches: totalMatches,
      filesChanged,
      dryRun: args.dryRun,
    }
  );
}

export function registerSearchAndReplaceTool(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  const handler = (
    args: z.infer<typeof SearchAndReplaceInputSchema>,
    extra: ToolExtra
  ): Promise<ToolResult<z.infer<typeof SearchAndReplaceOutputSchema>>> =>
    withToolDiagnostics(
      'search_and_replace',
      () =>
        withToolErrorHandling(
          async () => {
            const { signal, cleanup } = createTimedAbortSignal(extra.signal);
            try {
              return await handleSearchAndReplace(args, signal);
            } finally {
              cleanup();
            }
          },
          (error) =>
            buildToolErrorResponse(error, ErrorCode.E_UNKNOWN, args.path)
        ),
      args.path ? { path: args.path } : {}
    );

  server.registerTool(
    'search_and_replace',
    withDefaultIcons({ ...SEARCH_AND_REPLACE_TOOL }, options.iconInfo),
    wrapToolHandler(handler, {
      guard: options.isInitialized,
      progressMessage: (args) => {
        return `replace: ${args.filePattern}`;
      },
    })
  );
}
