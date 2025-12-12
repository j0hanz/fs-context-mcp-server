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
        'Retrieve detailed metadata about a file or directory without reading its contents. ' +
        'Returns: name, path, type, size, timestamps (created/modified/accessed), permissions, ' +
        'MIME type (for files), hidden status, and symlink target (if applicable). ' +
        'Use this to check file properties before reading large files.',
      inputSchema: GetFileInfoInputSchema,
      outputSchema: GetFileInfoOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
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
