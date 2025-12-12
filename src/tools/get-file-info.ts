import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createErrorResponse, ErrorCode } from '../lib/errors.js';
import { getFileInfo } from '../lib/file-operations.js';
import { formatFileInfo } from '../lib/formatters.js';
import {
  GetFileInfoInputSchema,
  GetFileInfoOutputSchema,
} from '../schemas/index.js';

export function registerGetFileInfoTool(server: McpServer): void {
  server.registerTool(
    'get_file_info',
    {
      title: 'Get File Info',
      description:
        'Get detailed metadata about a file or directory including size, timestamps, and permissions.',
      inputSchema: GetFileInfoInputSchema,
      outputSchema: GetFileInfoOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ path }) => {
      try {
        const info = await getFileInfo(path);
        const structured = {
          ok: true,
          info: {
            name: info.name,
            path: info.path,
            type: info.type,
            size: info.size,
            created: info.created.toISOString(),
            modified: info.modified.toISOString(),
            accessed: info.accessed.toISOString(),
            permissions: info.permissions,
            isHidden: info.isHidden,
            mimeType: info.mimeType,
            symlinkTarget: info.symlinkTarget,
          },
        };
        return {
          content: [{ type: 'text', text: formatFileInfo(info) }],
          structuredContent: structured,
        };
      } catch (error) {
        return createErrorResponse(error, ErrorCode.E_NOT_FOUND, path);
      }
    }
  );
}
