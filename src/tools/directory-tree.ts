import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createErrorResponse, ErrorCode } from '../lib/errors.js';
import { getDirectoryTree } from '../lib/file-operations.js';
import { formatTreeEntry } from '../lib/formatters.js';
import {
  DirectoryTreeInputSchema,
  DirectoryTreeOutputSchema,
} from '../schemas/index.js';

export function registerDirectoryTreeTool(server: McpServer): void {
  server.registerTool(
    'directory_tree',
    {
      title: 'Directory Tree',
      description:
        'Get a JSON tree structure of a directory. More efficient for AI parsing than flat file lists. Useful for understanding project structure.',
      inputSchema: DirectoryTreeInputSchema,
      outputSchema: DirectoryTreeOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({
      path,
      maxDepth,
      excludePatterns,
      includeHidden,
      includeSize,
      maxFiles,
    }) => {
      try {
        const result = await getDirectoryTree(path, {
          maxDepth,
          excludePatterns,
          includeHidden,
          includeSize,
          maxFiles,
        });

        const textOutput = formatTreeEntry(result.tree);

        const structured = {
          ok: true,
          tree: result.tree,
          summary: {
            totalFiles: result.summary.totalFiles,
            totalDirectories: result.summary.totalDirectories,
            maxDepthReached: result.summary.maxDepthReached,
            truncated: result.summary.truncated,
            skippedInaccessible: result.summary.skippedInaccessible,
            skippedSymlinks: result.summary.skippedSymlinks,
          },
        };

        return {
          content: [{ type: 'text', text: textOutput }],
          structuredContent: structured,
        };
      } catch (error) {
        return createErrorResponse(error, ErrorCode.E_NOT_DIRECTORY, path);
      }
    }
  );
}
