import * as pathModule from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createErrorResponse, ErrorCode } from '../lib/errors.js';
import { searchFiles } from '../lib/file-operations.js';
import {
  formatOperationSummary,
  formatSearchResults,
} from '../lib/formatters.js';
import {
  SearchFilesInputSchema,
  SearchFilesOutputSchema,
} from '../schemas/index.js';
import { buildToolResponse, type ToolResponse } from './tool-response.js';

interface SearchFilesStructuredResult extends Record<string, unknown> {
  ok: true;
  basePath: string;
  pattern: string;
  results: {
    path: string;
    type: string;
    size?: number;
    modified?: string;
  }[];
  summary: {
    matched: number;
    truncated: boolean;
    skippedInaccessible: number;
    filesScanned: number;
  };
}

function buildStructuredResult(
  result: Awaited<ReturnType<typeof searchFiles>>
): SearchFilesStructuredResult {
  return {
    ok: true,
    basePath: result.basePath,
    pattern: result.pattern,
    results: result.results.map((r) => ({
      path: pathModule.relative(result.basePath, r.path),
      type: r.type,
      size: r.size,
      modified: r.modified?.toISOString(),
    })),
    summary: {
      matched: result.summary.matched,
      truncated: result.summary.truncated,
      skippedInaccessible: result.summary.skippedInaccessible,
      filesScanned: result.summary.filesScanned,
    },
  };
}

function buildTextResult(
  result: Awaited<ReturnType<typeof searchFiles>>
): string {
  let textOutput = formatSearchResults(result.results);
  textOutput += formatOperationSummary({
    truncated: result.summary.truncated,
    truncatedReason: `reached max results limit (${result.summary.matched} returned)`,
    tip: 'Increase maxResults, use more specific pattern, or add excludePatterns to narrow scope.',
    skippedInaccessible: result.summary.skippedInaccessible,
  });
  return textOutput;
}

async function handleSearchFiles({
  path: searchBasePath,
  pattern,
  excludePatterns,
  maxResults,
  sortBy,
  maxDepth,
}: {
  path: string;
  pattern: string;
  excludePatterns?: string[];
  maxResults?: number;
  sortBy?: 'name' | 'size' | 'modified' | 'path';
  maxDepth?: number;
}): Promise<ToolResponse<SearchFilesStructuredResult>> {
  const result = await searchFiles(searchBasePath, pattern, excludePatterns, {
    maxResults,
    sortBy,
    maxDepth,
  });
  return buildToolResponse(
    buildTextResult(result),
    buildStructuredResult(result)
  );
}

const SEARCH_FILES_TOOL = {
  title: 'Search Files',
  description:
    'Find files matching a glob pattern within a directory tree. ' +
    'Pattern examples: "**/*.ts" (all TypeScript files), "src/**/*.{js,jsx}" (JS/JSX in src), ' +
    '"**/test/**" (all test directories). Returns paths, types, sizes, and modification dates. ' +
    'Use excludePatterns to skip directories like node_modules.',
  inputSchema: SearchFilesInputSchema,
  outputSchema: SearchFilesOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
} as const;

export function registerSearchFilesTool(server: McpServer): void {
  server.registerTool('search_files', SEARCH_FILES_TOOL, async (args) => {
    try {
      return await handleSearchFiles(args);
    } catch (error) {
      return createErrorResponse(error, ErrorCode.E_INVALID_PATTERN, args.path);
    }
  });
}
