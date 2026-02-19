import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import { joinLines } from '../config.js';
import { ErrorCode } from '../lib/errors.js';
import { getAllowedDirectories } from '../lib/path-validation.js';
import {
  ListAllowedDirectoriesInputSchema,
  type ListAllowedDirectoriesOutputSchema,
} from '../schemas.js';
import {
  buildToolErrorResponse,
  buildToolResponse,
  executeToolWithDiagnostics,
  READ_ONLY_TOOL_ANNOTATIONS,
  type ToolExtra,
  type ToolRegistrationOptions,
  type ToolResponse,
  type ToolResult,
  withDefaultIcons,
  wrapToolHandler,
} from './shared.js';

const LIST_ALLOWED_DIRECTORIES_TOOL = {
  title: 'Workspace Roots',
  description:
    'List the workspace roots this server can access. ' +
    'Call this first to see available directories. ' +
    'All other tools only work within these directories.',
  inputSchema: ListAllowedDirectoriesInputSchema,
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
} as const;

function buildTextRoots(dirs: string[]): string {
  if (dirs.length === 0) {
    return 'No directories configured';
  }
  return joinLines([
    `${dirs.length} workspace roots:`,
    ...dirs.map((d) => `  ${d}`),
  ]);
}

function handleListAllowedDirectories(): ToolResponse<
  z.infer<typeof ListAllowedDirectoriesOutputSchema>
> {
  const dirs = getAllowedDirectories();
  const structured = {
    ok: true,
    directories: dirs,
    rootsCount: dirs.length,
    hasMultipleRoots: dirs.length > 1,
  } as const;
  return buildToolResponse(buildTextRoots(dirs), structured);
}

export function registerListAllowedDirectoriesTool(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  const handler = (
    _args: z.infer<typeof ListAllowedDirectoriesInputSchema>,
    extra: ToolExtra
  ): Promise<ToolResult<z.infer<typeof ListAllowedDirectoriesOutputSchema>>> =>
    executeToolWithDiagnostics({
      toolName: 'roots',
      extra,
      run: () => handleListAllowedDirectories(),
      onError: (error) => buildToolErrorResponse(error, ErrorCode.E_UNKNOWN),
    });

  server.registerTool(
    'roots',
    withDefaultIcons({ ...LIST_ALLOWED_DIRECTORIES_TOOL }, options.iconInfo),
    wrapToolHandler(handler, {
      guard: options.isInitialized,
      progressMessage: () => '≣ roots',
    })
  );
}
