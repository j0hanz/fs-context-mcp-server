import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createErrorResponse, ErrorCode } from '../lib/errors.js';
import { getFileInfo } from '../lib/file-operations.js';
import { formatFileInfo } from '../lib/formatters.js';
import {
  GetFileInfoInputSchema,
  GetFileInfoOutputSchema,
} from '../schemas/index.js';
import { buildToolResponse, type ToolResponse } from './tool-response.js';

interface GetFileInfoStructuredResult extends Record<string, unknown> {
  ok: true;
  info: {
    name: string;
    path: string;
    type: string;
    size: number;
    created: string;
    modified: string;
    accessed: string;
    permissions: string;
    isHidden: boolean;
    mimeType?: string;
    symlinkTarget?: string;
  };
}

function buildStructuredResult(
  info: Awaited<ReturnType<typeof getFileInfo>>
): GetFileInfoStructuredResult {
  return {
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
}

async function handleGetFileInfo({
  path,
}: {
  path: string;
}): Promise<ToolResponse<GetFileInfoStructuredResult>> {
  const info = await getFileInfo(path);
  const structured = buildStructuredResult(info);
  return buildToolResponse(formatFileInfo(info), structured);
}

const GET_FILE_INFO_TOOL = {
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
} as const;

export function registerGetFileInfoTool(server: McpServer): void {
  server.registerTool('get_file_info', GET_FILE_INFO_TOOL, async (args) => {
    try {
      return await handleGetFileInfo(args);
    } catch (error) {
      return createErrorResponse(error, ErrorCode.E_NOT_FOUND, args.path);
    }
  });
}
