import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerListDirectoryTool } from './tools/list-directory.js';
import { registerReadMultipleFilesTool } from './tools/read-multiple.js';
import { registerReadFileTool } from './tools/read.js';
import { registerListAllowedDirectoriesTool } from './tools/roots.js';
import { registerSearchContentTool } from './tools/search-content.js';
import { registerSearchFilesTool } from './tools/search-files.js';
import type { ToolRegistrationOptions } from './tools/shared.js';
import { registerGetMultipleFileInfoTool } from './tools/stat-many.js';
import { registerGetFileInfoTool } from './tools/stat.js';
import { registerTreeTool } from './tools/tree.js';

export { buildToolErrorResponse, buildToolResponse } from './tools/shared.js';
export type {
  ToolExtra,
  ToolRegistrationOptions,
  ToolResult,
} from './tools/shared.js';
export { registerListAllowedDirectoriesTool } from './tools/roots.js';
export { registerListDirectoryTool } from './tools/list-directory.js';
export { registerSearchFilesTool } from './tools/search-files.js';
export { registerTreeTool } from './tools/tree.js';
export { registerReadFileTool } from './tools/read.js';
export { registerReadMultipleFilesTool } from './tools/read-multiple.js';
export { registerGetFileInfoTool } from './tools/stat.js';
export { registerGetMultipleFileInfoTool } from './tools/stat-many.js';
export { registerSearchContentTool } from './tools/search-content.js';

export function registerAllTools(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  registerListAllowedDirectoriesTool(server, options);
  registerListDirectoryTool(server, options);
  registerSearchFilesTool(server, options);
  registerTreeTool(server, options);
  registerReadFileTool(server, options);
  registerReadMultipleFilesTool(server, options);
  registerGetFileInfoTool(server, options);
  registerGetMultipleFileInfoTool(server, options);
  registerSearchContentTool(server, options);
}
