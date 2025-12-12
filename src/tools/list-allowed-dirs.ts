import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { formatAllowedDirectories } from '../lib/formatters.js';
import { getAllowedDirectories } from '../lib/path-validation.js';
import { ListAllowedDirectoriesOutputSchema } from '../schemas/index.js';

export function registerListAllowedDirectoriesTool(server: McpServer): void {
  server.registerTool(
    'list_allowed_directories',
    {
      title: 'List Allowed Directories',
      description:
        'List all directories that this server is allowed to access. Use this to understand the scope of available file operations.',
      inputSchema: {},
      outputSchema: ListAllowedDirectoriesOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    () => {
      const dirs = getAllowedDirectories();
      const structured = { ok: true, allowedDirectories: dirs };
      return {
        content: [{ type: 'text', text: formatAllowedDirectories(dirs) }],
        structuredContent: structured,
      };
    }
  );
}
