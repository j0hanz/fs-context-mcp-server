import * as fs from 'node:fs/promises';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import safeRegex from 'safe-regex2';

import {
  ErrorCode,
  formatUnknownErrorMessage,
  McpError,
} from '../lib/errors.js';
import { globEntries } from '../lib/file-operations/glob-engine.js';
import { atomicWriteFile, createTimedAbortSignal } from '../lib/fs-helpers.js';
import { withToolDiagnostics } from '../lib/observability.js';
import {
  validateExistingPath,
  validatePathForWrite,
} from '../lib/path-validation.js';
import {
  SearchAndReplaceInputSchema,
  SearchAndReplaceOutputSchema,
} from '../schemas.js';
import {
  buildToolErrorResponse,
  buildToolResponse,
  resolvePathOrRoot,
  type ToolExtra,
  type ToolRegistrationOptions,
  type ToolResponse,
  type ToolResult,
  withDefaultIcons,
  withToolErrorHandling,
  wrapToolHandler,
} from './shared.js';
import { createToolTaskHandler } from './task-support.js';

const SEARCH_AND_REPLACE_TOOL = {
  name: 'search_and_replace',
  description: 'Search and replace text across multiple files.',
  inputSchema: SearchAndReplaceInputSchema,
  outputSchema: SearchAndReplaceOutputSchema,
} as const;

const MAX_FAILURES = 20;

interface Failure {
  path: string;
  error: string;
}

function recordFailure(failures: Failure[], failure: Failure): void {
  if (failures.length >= MAX_FAILURES) return;
  failures.push(failure);
}

async function processFile(
  filePath: string,
  args: z.infer<typeof SearchAndReplaceInputSchema>,
  signal?: AbortSignal
): Promise<{ matches: number; changed: boolean; error?: string }> {
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
  } catch (error) {
    return {
      matches: 0,
      changed: false,
      error: formatUnknownErrorMessage(error),
    };
  }
}

async function handleSearchAndReplace(
  args: z.infer<typeof SearchAndReplaceInputSchema>,
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof SearchAndReplaceOutputSchema>>> {
  const root = args.path
    ? await validateExistingPath(args.path, signal)
    : resolvePathOrRoot(args.path);

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
  let failedFiles = 0;
  const failures: Failure[] = [];

  const resolveValidPath = async (
    entryPath: string
  ): Promise<{ path: string } | { error: string }> => {
    try {
      const validPath = await validatePathForWrite(entryPath, signal);
      return { path: validPath };
    } catch (error) {
      return { error: formatUnknownErrorMessage(error) };
    }
  };

  const applyResult = (result: {
    matches: number;
    changed: boolean;
    error?: string;
    path: string;
  }): void => {
    if (result.matches > 0) {
      totalMatches += result.matches;
      filesChanged++;
    }

    if (result.error) {
      failedFiles++;
      recordFailure(failures, { path: result.path, error: result.error });
    }
  };

  for await (const entry of entries) {
    if (signal?.aborted) break;

    const resolved = await resolveValidPath(entry.path);
    if ('error' in resolved) {
      failedFiles++;
      recordFailure(failures, { path: entry.path, error: resolved.error });
      continue;
    }

    const result = await processFile(resolved.path, args, signal);
    applyResult({ ...result, path: resolved.path });
  }

  const failureSuffix = failedFiles > 0 ? ` (${failedFiles} failed)` : '';

  return buildToolResponse(
    `Found ${totalMatches} matches in ${filesChanged} files${failureSuffix}.${args.dryRun ? ' (Dry run)' : ''}`,
    {
      ok: true,
      matches: totalMatches,
      filesChanged,
      ...(failedFiles > 0 ? { failedFiles } : {}),
      ...(failures.length > 0 ? { failures } : {}),
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

  const wrappedHandler = wrapToolHandler(handler, {
    progressMessage: (args) => {
      return `replace: ${args.filePattern}`;
    },
  });

  const { isInitialized } = options;
  const taskOptions = isInitialized ? { guard: isInitialized } : undefined;

  const { experimental } = server as unknown as {
    experimental?: {
      tasks?: { registerToolTask?: (...args: unknown[]) => unknown };
    };
  };
  const { tasks } = experimental ?? {};

  if (tasks?.registerToolTask) {
    tasks.registerToolTask(
      'search_and_replace',
      withDefaultIcons(
        {
          ...SEARCH_AND_REPLACE_TOOL,
          execution: { taskSupport: 'optional' },
        },
        options.iconInfo
      ),
      createToolTaskHandler(wrappedHandler, taskOptions)
    );
    return;
  }

  server.registerTool(
    'search_and_replace',
    withDefaultIcons({ ...SEARCH_AND_REPLACE_TOOL }, options.iconInfo),
    wrappedHandler
  );
}
