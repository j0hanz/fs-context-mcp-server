import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerApplyPatchTool } from './tools/apply-patch.js';
import { registerCalculateHashTool } from './tools/calculate-hash.js';
import { registerCreateDirectoryTool } from './tools/create-directory.js';
import { registerDeleteFileTool } from './tools/delete-file.js';
import { registerDiffFilesTool } from './tools/diff-files.js';
import { registerEditFileTool } from './tools/edit-file.js';
import { registerListDirectoryTool } from './tools/list-directory.js';
import { registerMoveFileTool } from './tools/move-file.js';
import { registerReadMultipleFilesTool } from './tools/read-multiple.js';
import { registerReadFileTool } from './tools/read.js';
import { registerSearchAndReplaceTool } from './tools/replace-in-files.js';
import { registerListAllowedDirectoriesTool } from './tools/roots.js';
import { registerSearchContentTool } from './tools/search-content.js';
import { registerSearchFilesTool } from './tools/search-files.js';
import type { ToolRegistrationOptions } from './tools/shared.js';
import { registerGetMultipleFileInfoTool } from './tools/stat-many.js';
import { registerGetFileInfoTool } from './tools/stat.js';
import { registerTreeTool } from './tools/tree.js';
import { registerWriteFileTool } from './tools/write-file.js';

export { buildToolErrorResponse, buildToolResponse } from './tools/shared.js';

const TOOL_REGISTRARS = [
  registerListAllowedDirectoriesTool,
  registerListDirectoryTool,
  registerSearchFilesTool,
  registerTreeTool,
  registerReadFileTool,
  registerReadMultipleFilesTool,
  registerGetFileInfoTool,
  registerGetMultipleFileInfoTool,
  registerSearchContentTool,
  registerCreateDirectoryTool,
  registerWriteFileTool,
  registerEditFileTool,
  registerMoveFileTool,
  registerDeleteFileTool,
  registerCalculateHashTool,
  registerDiffFilesTool,
  registerApplyPatchTool,
  registerSearchAndReplaceTool,
] as const;

export function registerAllTools(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  for (const registerTool of TOOL_REGISTRARS) {
    registerTool(server, options);
  }
}
