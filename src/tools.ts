import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  APPLY_PATCH_TOOL,
  registerApplyPatchTool,
} from './tools/apply-patch.js';
import {
  CALCULATE_HASH_TOOL,
  registerCalculateHashTool,
} from './tools/calculate-hash.js';
import { type ToolContract } from './tools/contract.js';
import {
  CREATE_DIRECTORY_TOOL,
  registerCreateDirectoryTool,
} from './tools/create-directory.js';
import {
  DELETE_FILE_TOOL,
  registerDeleteFileTool,
} from './tools/delete-file.js';
import { DIFF_FILES_TOOL, registerDiffFilesTool } from './tools/diff-files.js';
import { EDIT_FILE_TOOL, registerEditFileTool } from './tools/edit-file.js';
import {
  LIST_DIRECTORY_TOOL,
  registerListDirectoryTool,
} from './tools/list-directory.js';
import { MOVE_FILE_TOOL, registerMoveFileTool } from './tools/move-file.js';
import {
  READ_MULTIPLE_FILES_TOOL,
  registerReadMultipleFilesTool,
} from './tools/read-multiple.js';
import { READ_FILE_TOOL, registerReadFileTool } from './tools/read.js';
import {
  registerSearchAndReplaceTool,
  SEARCH_AND_REPLACE_TOOL,
} from './tools/replace-in-files.js';
import {
  LIST_ALLOWED_DIRECTORIES_TOOL,
  registerListAllowedDirectoriesTool,
} from './tools/roots.js';
import {
  registerSearchContentTool,
  SEARCH_CONTENT_TOOL,
} from './tools/search-content.js';
import {
  registerSearchFilesTool,
  SEARCH_FILES_TOOL,
} from './tools/search-files.js';
import type { ToolRegistrationOptions } from './tools/shared.js';
import {
  GET_MULTIPLE_FILE_INFO_TOOL,
  registerGetMultipleFileInfoTool,
} from './tools/stat-many.js';
import { GET_FILE_INFO_TOOL, registerGetFileInfoTool } from './tools/stat.js';
import { registerTreeTool, TREE_TOOL } from './tools/tree.js';
import { registerWriteFileTool, WRITE_FILE_TOOL } from './tools/write-file.js';

export { buildToolErrorResponse, buildToolResponse } from './tools/shared.js';

export const ALL_TOOLS: ToolContract[] = [
  LIST_ALLOWED_DIRECTORIES_TOOL,
  LIST_DIRECTORY_TOOL,
  SEARCH_FILES_TOOL,
  TREE_TOOL,
  READ_FILE_TOOL,
  READ_MULTIPLE_FILES_TOOL,
  GET_FILE_INFO_TOOL,
  GET_MULTIPLE_FILE_INFO_TOOL,
  SEARCH_CONTENT_TOOL,
  CREATE_DIRECTORY_TOOL,
  WRITE_FILE_TOOL,
  EDIT_FILE_TOOL,
  MOVE_FILE_TOOL,
  DELETE_FILE_TOOL,
  CALCULATE_HASH_TOOL,
  DIFF_FILES_TOOL,
  APPLY_PATCH_TOOL,
  SEARCH_AND_REPLACE_TOOL,
];

type ToolRegistrar = (
  server: McpServer,
  options?: ToolRegistrationOptions
) => void;

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
] as const satisfies readonly ToolRegistrar[];

export function registerAllTools(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  for (const registerTool of TOOL_REGISTRARS) {
    registerTool(server, options);
  }
}
