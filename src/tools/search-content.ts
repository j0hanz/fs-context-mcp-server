import * as pathModule from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createErrorResponse, ErrorCode } from '../lib/errors.js';
import { searchContent } from '../lib/file-operations.js';
import {
  formatContentMatches,
  formatOperationSummary,
} from '../lib/formatters.js';
import {
  SearchContentInputSchema,
  SearchContentOutputSchema,
} from '../schemas/index.js';
import { buildToolResponse, type ToolResponse } from './tool-response.js';

interface SearchContentStructuredResult extends Record<string, unknown> {
  ok: true;
  basePath: string;
  pattern: string;
  filePattern: string;
  matches: {
    file: string;
    line: number;
    content: string;
    contextBefore?: string[];
    contextAfter?: string[];
    matchCount: number;
  }[];
  summary: {
    filesScanned: number;
    filesMatched: number;
    totalMatches: number;
    truncated: boolean;
    skippedTooLarge?: number;
    skippedBinary?: number;
    skippedInaccessible?: number;
    linesSkippedDueToRegexTimeout?: number;
    stoppedReason?: 'maxResults' | 'maxFiles' | 'timeout';
  };
}

function buildStructuredResult(
  result: Awaited<ReturnType<typeof searchContent>>
): SearchContentStructuredResult {
  return {
    ok: true,
    basePath: result.basePath,
    pattern: result.pattern,
    filePattern: result.filePattern,
    matches: result.matches.map((m) => ({
      file: pathModule.relative(result.basePath, m.file),
      line: m.line,
      content: m.content,
      contextBefore: m.contextBefore,
      contextAfter: m.contextAfter,
      matchCount: m.matchCount,
    })),
    summary: {
      filesScanned: result.summary.filesScanned,
      filesMatched: result.summary.filesMatched,
      totalMatches: result.summary.matches,
      truncated: result.summary.truncated,
      skippedTooLarge: result.summary.skippedTooLarge || undefined,
      skippedBinary: result.summary.skippedBinary || undefined,
      skippedInaccessible: result.summary.skippedInaccessible || undefined,
      linesSkippedDueToRegexTimeout:
        result.summary.linesSkippedDueToRegexTimeout || undefined,
      stoppedReason: result.summary.stoppedReason,
    },
  };
}

function buildTruncationInfo(
  result: Awaited<ReturnType<typeof searchContent>>
): { truncatedReason?: string; tip?: string } {
  if (!result.summary.truncated) return {};
  if (result.summary.stoppedReason === 'timeout') {
    return {
      truncatedReason: 'search timed out',
      tip: 'Increase timeoutMs, use more specific filePattern, or add excludePatterns to narrow scope.',
    };
  }
  if (result.summary.stoppedReason === 'maxResults') {
    return {
      truncatedReason: `reached max results limit (${result.summary.matches})`,
    };
  }
  if (result.summary.stoppedReason === 'maxFiles') {
    return {
      truncatedReason: `reached max files limit (${result.summary.filesScanned} scanned)`,
    };
  }
  return {};
}

function buildTextResult(
  result: Awaited<ReturnType<typeof searchContent>>
): string {
  const { truncatedReason, tip } = buildTruncationInfo(result);
  let textOutput = formatContentMatches(result.matches);
  textOutput += formatOperationSummary({
    truncated: result.summary.truncated,
    truncatedReason,
    tip,
    skippedTooLarge: result.summary.skippedTooLarge,
    skippedBinary: result.summary.skippedBinary,
    skippedInaccessible: result.summary.skippedInaccessible,
    linesSkippedDueToRegexTimeout: result.summary.linesSkippedDueToRegexTimeout,
  });

  if (result.summary.truncated && !tip) {
    textOutput += `\nScanned ${result.summary.filesScanned} files, found ${result.summary.matches} matches in ${result.summary.filesMatched} files.`;
  }

  return textOutput;
}

async function handleSearchContent({
  path: searchBasePath,
  pattern,
  filePattern,
  excludePatterns,
  caseSensitive,
  maxResults,
  maxFileSize,
  maxFilesScanned,
  timeoutMs,
  skipBinary,
  includeHidden,
  contextLines,
  wholeWord,
  isLiteral,
}: {
  path: string;
  pattern: string;
  filePattern?: string;
  excludePatterns?: string[];
  caseSensitive?: boolean;
  maxResults?: number;
  maxFileSize?: number;
  maxFilesScanned?: number;
  timeoutMs?: number;
  skipBinary?: boolean;
  includeHidden?: boolean;
  contextLines?: number;
  wholeWord?: boolean;
  isLiteral?: boolean;
}): Promise<ToolResponse<SearchContentStructuredResult>> {
  const result = await searchContent(searchBasePath, pattern, {
    filePattern,
    excludePatterns,
    caseSensitive,
    maxResults,
    maxFileSize,
    maxFilesScanned,
    timeoutMs,
    skipBinary,
    includeHidden,
    contextLines,
    wholeWord,
    isLiteral,
  });

  return buildToolResponse(
    buildTextResult(result),
    buildStructuredResult(result)
  );
}

const SEARCH_CONTENT_TOOL = {
  title: 'Search Content',
  description:
    'Search for text patterns within file contents using regular expressions (grep-like). ' +
    'Returns matching lines with optional context (contextLines parameter). ' +
    'Use isLiteral=true for exact string matching, wholeWord=true to avoid partial matches. ' +
    'Filter files with filePattern glob (e.g., "**/*.ts" for TypeScript only). ' +
    'Automatically skips binary files unless skipBinary=false.',
  inputSchema: SearchContentInputSchema,
  outputSchema: SearchContentOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
} as const;

export function registerSearchContentTool(server: McpServer): void {
  server.registerTool('search_content', SEARCH_CONTENT_TOOL, async (args) => {
    try {
      return await handleSearchContent(args);
    } catch (error) {
      return createErrorResponse(error, ErrorCode.E_UNKNOWN, args.path);
    }
  });
}
