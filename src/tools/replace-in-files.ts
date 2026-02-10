import * as fs from 'node:fs/promises';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import RE2 from 're2';
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
  createProgressReporter,
  notifyProgress,
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
  title: 'Search and Replace',
  description: 'Search and replace text across multiple files.',
  inputSchema: SearchAndReplaceInputSchema,
  outputSchema: SearchAndReplaceOutputSchema,
  annotations: {
    readOnlyHint: false,
    openWorldHint: false,
  },
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

function createRegexMatcher(pattern: string): RE2 {
  try {
    return new RE2(pattern, 'g');
  } catch (error) {
    throw new McpError(
      ErrorCode.E_INVALID_INPUT,
      `Invalid regex pattern: ${formatUnknownErrorMessage(error)}`
    );
  }
}

function countRegexMatches(content: string, regex: RE2): number {
  regex.lastIndex = 0;
  let count = 0;
  while (regex.exec(content) !== null) {
    count++;
    if (regex.lastIndex === 0) {
      regex.lastIndex++;
    }
  }
  return count;
}

async function processFile(
  filePath: string,
  args: z.infer<typeof SearchAndReplaceInputSchema>,
  regex: RE2 | undefined,
  signal?: AbortSignal
): Promise<{ matches: number; changed: boolean; error?: string }> {
  try {
    const content = await fs.readFile(filePath, {
      encoding: 'utf-8',
      signal,
    });
    let newContent = content;
    let matchCount = 0;

    if (args.isRegex && regex) {
      matchCount = countRegexMatches(content, regex);
      if (matchCount > 0) {
        regex.lastIndex = 0;
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

interface ReplaceSummary {
  totalMatches: number;
  filesChanged: number;
  failedFiles: number;
  processedFiles: number;
  failures: Failure[];
}

function createReplaceSummary(): ReplaceSummary {
  return {
    totalMatches: 0,
    filesChanged: 0,
    failedFiles: 0,
    processedFiles: 0,
    failures: [],
  };
}

async function resolveSearchRoot(
  pathValue: string | undefined,
  signal?: AbortSignal
): Promise<string> {
  return pathValue
    ? validateExistingPath(pathValue, signal)
    : resolvePathOrRoot(pathValue);
}

function createReplacementRegex(
  args: z.infer<typeof SearchAndReplaceInputSchema>
): RE2 | undefined {
  if (!args.isRegex) return undefined;
  if (!safeRegex(args.searchPattern)) {
    throw new McpError(
      ErrorCode.E_INVALID_INPUT,
      `Unsafe regex pattern: ${args.searchPattern}`
    );
  }
  return createRegexMatcher(args.searchPattern);
}

function reportReplaceProgress(
  onProgress:
    | ((progress: { total?: number; current: number }) => void)
    | undefined,
  current: number,
  force = false
): void {
  if (!onProgress || current === 0) return;
  if (!force && current % 25 !== 0) return;
  onProgress({ current });
}

async function processEntry(
  entryPath: string,
  args: z.infer<typeof SearchAndReplaceInputSchema>,
  regex: RE2 | undefined,
  signal: AbortSignal | undefined,
  summary: ReplaceSummary
): Promise<void> {
  let validPath: string;
  try {
    validPath = await validatePathForWrite(entryPath, signal);
  } catch (error) {
    summary.failedFiles++;
    recordFailure(summary.failures, {
      path: entryPath,
      error: formatUnknownErrorMessage(error),
    });
    return;
  }

  const result = await processFile(validPath, args, regex, signal);
  if (result.matches > 0) {
    summary.totalMatches += result.matches;
    summary.filesChanged++;
  }

  if (result.error) {
    summary.failedFiles++;
    recordFailure(summary.failures, { path: validPath, error: result.error });
  }
}

async function handleSearchAndReplace(
  args: z.infer<typeof SearchAndReplaceInputSchema>,
  signal?: AbortSignal,
  onProgress?: (progress: { total?: number; current: number }) => void
): Promise<ToolResponse<z.infer<typeof SearchAndReplaceOutputSchema>>> {
  const root = await resolveSearchRoot(args.path, signal);
  const regex = createReplacementRegex(args);

  const entries = globEntries({
    cwd: root,
    pattern: args.filePattern,
    excludePatterns: args.excludePatterns,
    includeHidden: false,
    baseNameMatch: false,
    caseSensitiveMatch: true, // Default to sensitive for file paths
    followSymbolicLinks: false,
    onlyFiles: true,
    stats: false,
    suppressErrors: true,
  });

  const summary = createReplaceSummary();

  for await (const entry of entries) {
    if (signal?.aborted) break;
    summary.processedFiles++;
    reportReplaceProgress(onProgress, summary.processedFiles);
    await processEntry(entry.path, args, regex, signal, summary);
  }

  reportReplaceProgress(onProgress, summary.processedFiles, true);

  const failureSuffix =
    summary.failedFiles > 0 ? ` (${summary.failedFiles} failed)` : '';

  return buildToolResponse(
    `Found ${summary.totalMatches} matches in ${summary.filesChanged} files${failureSuffix}.${args.dryRun ? ' (Dry run)' : ''}`,
    {
      ok: true,
      matches: summary.totalMatches,
      filesChanged: summary.filesChanged,
      processedFiles: summary.processedFiles,
      ...(summary.failedFiles > 0 ? { failedFiles: summary.failedFiles } : {}),
      ...(summary.failures.length > 0 ? { failures: summary.failures } : {}),
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
            notifyProgress(extra, {
              current: 0,
              message: `replace: ${args.filePattern}`,
            });
            const { signal, cleanup } = createTimedAbortSignal(extra.signal);
            try {
              const result = await handleSearchAndReplace(
                args,
                signal,
                createProgressReporter(extra)
              );
              const sc = result.structuredContent;
              const finalCurrent = (sc.processedFiles ?? 0) + 1;
              notifyProgress(extra, {
                current: finalCurrent,
                message: `replace: ${args.filePattern} → ${String(sc.filesChanged ?? 0)} files`,
              });
              return result;
            } finally {
              cleanup();
            }
          },
          (error) =>
            buildToolErrorResponse(error, ErrorCode.E_UNKNOWN, args.path)
        ),
      args.path ? { path: args.path } : {}
    );

  const { isInitialized } = options;

  const wrappedHandler = wrapToolHandler(handler, {
    guard: isInitialized,
  });
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
