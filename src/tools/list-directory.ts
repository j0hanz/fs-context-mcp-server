import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createErrorResponse, ErrorCode } from '../lib/errors.js';
import { listDirectory } from '../lib/file-operations.js';
import { formatDirectoryListing } from '../lib/formatters.js';
import {
  ListDirectoryInputSchema,
  ListDirectoryOutputSchema,
} from '../schemas/index.js';

export function registerListDirectoryTool(server: McpServer): void {
  server.registerTool(
    'list_directory',
    {
      title: 'List Directory',
      description:
        'List contents of a directory. Returns files and subdirectories with their types and sizes. Supports recursive listing.',
      inputSchema: ListDirectoryInputSchema,
      outputSchema: ListDirectoryOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({
      path,
      recursive,
      includeHidden,
      maxDepth,
      maxEntries,
      sortBy,
      includeSymlinkTargets,
    }) => {
      try {
        const result = await listDirectory(path, {
          recursive,
          includeHidden,
          maxDepth,
          maxEntries,
          sortBy,
          includeSymlinkTargets,
        });
        const structured = {
          ok: true,
          path: result.path,
          entries: result.entries.map((e) => ({
            name: e.relativePath,
            type: e.type,
            size: e.size,
            modified: e.modified?.toISOString(),
            symlinkTarget: e.symlinkTarget,
          })),
          summary: {
            totalEntries: result.summary.totalEntries,
            totalFiles: result.summary.totalFiles,
            totalDirectories: result.summary.totalDirectories,
            maxDepthReached: result.summary.maxDepthReached,
            truncated: result.summary.truncated,
            skippedInaccessible: result.summary.skippedInaccessible,
            symlinksNotFollowed: result.summary.symlinksNotFollowed,
          },
        };
        return {
          content: [
            {
              type: 'text',
              text: formatDirectoryListing(result.entries, result.path),
            },
          ],
          structuredContent: structured,
        };
      } catch (error) {
        return createErrorResponse(error, ErrorCode.E_NOT_DIRECTORY, path);
      }
    }
  );
}
