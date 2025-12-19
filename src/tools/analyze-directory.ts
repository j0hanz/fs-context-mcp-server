import * as pathModule from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createErrorResponse, ErrorCode } from '../lib/errors.js';
import { analyzeDirectory } from '../lib/file-operations.js';
import {
  formatDirectoryAnalysis,
  formatOperationSummary,
} from '../lib/formatters.js';
import {
  AnalyzeDirectoryInputSchema,
  AnalyzeDirectoryOutputSchema,
} from '../schemas/index.js';
import { buildToolResponse, type ToolResponse } from './tool-response.js';

interface AnalyzeDirectoryStructuredResult extends Record<string, unknown> {
  ok: true;
  path: string;
  totalFiles: number;
  totalDirectories: number;
  totalSize: number;
  fileTypes: Record<string, number>;
  largestFiles: { path: string; size: number }[];
  recentlyModified: { path: string; modified: string }[];
  summary: {
    truncated: boolean;
    skippedInaccessible: number;
    symlinksNotFollowed: number;
  };
}

function buildStructuredResult(
  result: Awaited<ReturnType<typeof analyzeDirectory>>
): AnalyzeDirectoryStructuredResult {
  return {
    ok: true,
    path: result.analysis.path,
    totalFiles: result.analysis.totalFiles,
    totalDirectories: result.analysis.totalDirectories,
    totalSize: result.analysis.totalSize,
    fileTypes: result.analysis.fileTypes,
    largestFiles: result.analysis.largestFiles.map((f) => ({
      path: pathModule.relative(result.analysis.path, f.path),
      size: f.size,
    })),
    recentlyModified: result.analysis.recentlyModified.map((f) => ({
      path: pathModule.relative(result.analysis.path, f.path),
      modified: f.modified.toISOString(),
    })),
    summary: {
      truncated: result.summary.truncated,
      skippedInaccessible: result.summary.skippedInaccessible,
      symlinksNotFollowed: result.summary.symlinksNotFollowed,
    },
  };
}

function buildTextResult(
  result: Awaited<ReturnType<typeof analyzeDirectory>>
): string {
  let textOutput = formatDirectoryAnalysis(result.analysis);
  textOutput += formatOperationSummary({
    skippedInaccessible: result.summary.skippedInaccessible,
    symlinksNotFollowed: result.summary.symlinksNotFollowed,
  });
  return textOutput;
}

async function handleAnalyzeDirectory({
  path: dirPath,
  maxDepth,
  topN,
  excludePatterns,
  includeHidden,
}: {
  path: string;
  maxDepth?: number;
  topN?: number;
  excludePatterns?: string[];
  includeHidden?: boolean;
}): Promise<ToolResponse<AnalyzeDirectoryStructuredResult>> {
  const result = await analyzeDirectory(dirPath, {
    maxDepth,
    topN,
    excludePatterns,
    includeHidden,
  });
  const structured = buildStructuredResult(result);
  const textOutput = buildTextResult(result);
  return buildToolResponse(textOutput, structured);
}

const ANALYZE_DIRECTORY_TOOL = {
  title: 'Analyze Directory',
  description:
    'Gather statistics about a directory: total files/directories, total size, ' +
    'file type distribution by extension, largest files (topN), and most recently modified files. ' +
    'Useful for understanding project structure and identifying large files. ' +
    'Use excludePatterns to skip directories like node_modules.',
  inputSchema: AnalyzeDirectoryInputSchema,
  outputSchema: AnalyzeDirectoryOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
} as const;

export function registerAnalyzeDirectoryTool(server: McpServer): void {
  server.registerTool(
    'analyze_directory',
    ANALYZE_DIRECTORY_TOOL,
    async (args) => {
      try {
        return await handleAnalyzeDirectory(args);
      } catch (error) {
        return createErrorResponse(error, ErrorCode.E_NOT_DIRECTORY, args.path);
      }
    }
  );
}
