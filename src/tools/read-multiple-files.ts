import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import { joinLines } from '../config/formatting.js';
import { MAX_TEXT_FILE_SIZE } from '../lib/constants.js';
import { ErrorCode } from '../lib/errors.js';
import { readMultipleFiles } from '../lib/file-operations.js';
import {
  ReadMultipleFilesInputSchema,
  ReadMultipleFilesOutputSchema,
} from '../schemas/index.js';
import { createTimedAbortSignal } from './shared/abort.js';
import {
  assertLineRangeComplete,
  assertNoMixedRangeOptions,
} from './shared/read-range.js';
import {
  buildToolErrorResponse,
  buildToolResponse,
  type ToolResponse,
  type ToolResult,
  withToolErrorHandling,
} from './tool-response.js';

const READ_MULTIPLE_TIMEOUT_MS = 30000;

type ReadMultipleArgs = z.infer<typeof ReadMultipleFilesInputSchema>;
type ReadMultipleStructuredResult = z.infer<
  typeof ReadMultipleFilesOutputSchema
>;

function buildStructuredResult(
  results: Awaited<ReturnType<typeof readMultipleFiles>>,
  effectiveOptions: {
    encoding: BufferEncoding;
    maxSize: number;
    maxTotalSize: number;
    head?: number;
    tail?: number;
    lineStart?: number;
    lineEnd?: number;
  }
): ReadMultipleStructuredResult {
  const succeeded = results.filter((r) => r.content !== undefined).length;
  const failed = results.filter((r) => r.error !== undefined).length;

  return {
    ok: true,
    results,
    summary: {
      total: results.length,
      succeeded,
      failed,
    },
    effectiveOptions,
  };
}

function buildTextResult(
  results: Awaited<ReturnType<typeof readMultipleFiles>>
): string {
  return joinLines(results.map(formatReadMultipleResult));
}

function formatReadMultipleResult(
  result: Awaited<ReturnType<typeof readMultipleFiles>>[number]
): string {
  if (result.content !== undefined) {
    const note = buildReadMultipleNote(result);
    const rangeNote = buildReadMultipleRangeNote(result);
    const footer = [rangeNote, note].filter((value): value is string =>
      Boolean(value)
    );
    const contentBlock = footer.length
      ? joinLines([result.content, ...footer])
      : result.content;
    return joinLines([`=== ${result.path} ===`, contentBlock]);
  }
  return joinLines([
    `=== ${result.path} ===`,
    `[Error: ${result.error ?? 'Unknown error'}]`,
  ]);
}

function buildReadMultipleNote(
  result: Awaited<ReturnType<typeof readMultipleFiles>>[number]
): string {
  if (result.truncated !== true) return '';
  if (result.totalLines !== undefined) {
    return `[Truncated. Total lines: ${result.totalLines}]`;
  }
  return '[Truncated]';
}

function buildReadMultipleRangeNote(
  result: Awaited<ReturnType<typeof readMultipleFiles>>[number]
): string | undefined {
  if (result.readMode === 'lineRange') {
    if (result.lineStart !== undefined && result.lineEnd !== undefined) {
      return `Showing lines ${result.lineStart}-${result.lineEnd}`;
    }
  }
  if (result.readMode === 'head' && result.head !== undefined) {
    return `Showing first ${String(result.head)} lines`;
  }
  if (result.readMode === 'tail' && result.tail !== undefined) {
    return `Showing last ${String(result.tail)} lines`;
  }
  return undefined;
}

async function handleReadMultipleFiles(
  args: {
    paths: string[];
    encoding?: BufferEncoding;
    maxSize?: number;
    maxTotalSize?: number;
    head?: number;
    tail?: number;
    lineStart?: number;
    lineEnd?: number;
  },
  signal?: AbortSignal
): Promise<ToolResponse<ReadMultipleStructuredResult>> {
  const pathLabel = args.paths[0] ?? '<paths>';
  const hasHeadTail = args.head !== undefined || args.tail !== undefined;
  const hasLineRange =
    args.lineStart !== undefined || args.lineEnd !== undefined;
  assertLineRangeComplete(args.lineStart, args.lineEnd, pathLabel);
  assertNoMixedRangeOptions(hasHeadTail, hasLineRange, pathLabel);
  const effectiveOptions = {
    encoding: args.encoding ?? 'utf-8',
    maxSize: Math.min(args.maxSize ?? MAX_TEXT_FILE_SIZE, MAX_TEXT_FILE_SIZE),
    maxTotalSize: args.maxTotalSize ?? 100 * 1024 * 1024,
    head: args.head,
    tail: args.tail,
    lineStart: args.lineStart,
    lineEnd: args.lineEnd,
  };
  const results = await readMultipleFiles(args.paths, {
    encoding: effectiveOptions.encoding,
    maxSize: effectiveOptions.maxSize,
    maxTotalSize: effectiveOptions.maxTotalSize,
    head: effectiveOptions.head,
    tail: effectiveOptions.tail,
    lineStart: effectiveOptions.lineStart,
    lineEnd: effectiveOptions.lineEnd,
    signal,
  });

  return buildToolResponse(
    buildTextResult(results),
    buildStructuredResult(results, effectiveOptions)
  );
}

const READ_MULTIPLE_FILES_TOOL = {
  title: 'Read Multiple Files',
  description:
    'Read contents of multiple files in a single operation (parallel processing). ' +
    'More efficient than calling read_file repeatedly. ' +
    'Individual file errors do not fail the entire operation; each file reports success or error independently. ' +
    'Supports head/tail or lineStart/lineEnd for reading partial content from all files (mutually exclusive).',
  inputSchema: ReadMultipleFilesInputSchema,
  outputSchema: ReadMultipleFilesOutputSchema.shape,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
} as const;

export function registerReadMultipleFilesTool(server: McpServer): void {
  const handler = (
    args: ReadMultipleArgs,
    extra: { signal?: AbortSignal }
  ): Promise<ToolResult<ReadMultipleStructuredResult>> =>
    withToolErrorHandling(
      async () => {
        const { signal, cleanup } = createTimedAbortSignal(
          extra.signal,
          READ_MULTIPLE_TIMEOUT_MS
        );
        try {
          return await handleReadMultipleFiles(args, signal);
        } finally {
          cleanup();
        }
      },
      (error) => buildToolErrorResponse(error, ErrorCode.E_UNKNOWN)
    );

  server.registerTool('read_multiple_files', READ_MULTIPLE_FILES_TOOL, handler);
}
