import * as nodePath from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createErrorResponse, ErrorCode } from '../lib/errors.js';
import { analyzeDirectory } from '../lib/file-operations.js';
import { formatDirectoryAnalysis } from '../lib/formatters.js';
import {
  AnalyzeDirectoryInputSchema,
  AnalyzeDirectoryOutputSchema,
} from '../schemas/index.js';

export function registerAnalyzeDirectoryTool(server: McpServer): void {
  server.registerTool(
    'analyze_directory',
    {
      title: 'Analyze Directory',
      description:
        'Analyze a directory structure. Returns statistics including file counts, sizes, types, and lists of largest/recently modified files.',
      inputSchema: AnalyzeDirectoryInputSchema,
      outputSchema: AnalyzeDirectoryOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ path, maxDepth, topN, excludePatterns, includeHidden }) => {
      try {
        const result = await analyzeDirectory(path, {
          maxDepth,
          topN,
          excludePatterns,
          includeHidden,
        });
        const structured = {
          ok: true,
          path: result.analysis.path,
          totalFiles: result.analysis.totalFiles,
          totalDirectories: result.analysis.totalDirectories,
          totalSize: result.analysis.totalSize,
          fileTypes: result.analysis.fileTypes,
          largestFiles: result.analysis.largestFiles.map((f) => ({
            path: nodePath.relative(result.analysis.path, f.path),
            size: f.size,
          })),
          recentlyModified: result.analysis.recentlyModified.map((f) => ({
            path: nodePath.relative(result.analysis.path, f.path),
            modified: f.modified.toISOString(),
          })),
          summary: {
            truncated: result.summary.truncated,
            skippedInaccessible: result.summary.skippedInaccessible,
            symlinksNotFollowed: result.summary.symlinksNotFollowed,
          },
        };
        return {
          content: [
            { type: 'text', text: formatDirectoryAnalysis(result.analysis) },
          ],
          structuredContent: structured,
        };
      } catch (error) {
        return createErrorResponse(error, ErrorCode.E_NOT_DIRECTORY, path);
      }
    }
  );
}
