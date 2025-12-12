import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerAnalyzeCodebasePrompt } from './analyze-codebase.js';
import { registerFilesystemQueryPrompt } from './filesystem-query.js';
import { registerFindDuplicatesPrompt } from './find-duplicates.js';
import { registerProjectOverviewPrompt } from './project-overview.js';
import { registerSearchAndReplacePrompt } from './search-and-replace.js';

export function registerAllPrompts(server: McpServer): void {
  registerProjectOverviewPrompt(server);
  registerAnalyzeCodebasePrompt(server);
  registerFindDuplicatesPrompt(server);
  registerSearchAndReplacePrompt(server);
  registerFilesystemQueryPrompt(server);
}
