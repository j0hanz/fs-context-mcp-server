import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import { formatBytes, joinLines } from '../config.js';
import type { FileInfo } from '../config.js';
import { DEFAULT_SEARCH_TIMEOUT_MS } from '../lib/constants.js';
import { ErrorCode } from '../lib/errors.js';
import { getFileInfo } from '../lib/file-operations/file-info.js';
import { createTimedAbortSignal } from '../lib/fs-helpers.js';
import { withToolDiagnostics } from '../lib/observability.js';
import { GetFileInfoInputSchema, GetFileInfoOutputSchema } from '../schemas.js';
import {
  buildToolErrorResponse,
  buildToolResponse,
  type ToolExtra,
  type ToolRegistrationOptions,
  type ToolResponse,
  type ToolResult,
  withToolErrorHandling,
  wrapToolHandler,
} from './shared.js';

const GET_FILE_INFO_TOOL = {
  title: 'Get File Info',
  description:
    'Get metadata (size, modified time, permissions, mime type) for a file or directory.',
  inputSchema: GetFileInfoInputSchema,
  outputSchema: GetFileInfoOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

interface FileInfoPayload {
  name: string;
  path: string;
  type: FileInfo['type'];
  size: number;
  tokenEstimate?: number;
  created: string;
  modified: string;
  accessed: string;
  permissions: string;
  isHidden: boolean;
  mimeType?: string;
  symlinkTarget?: string;
}

function buildFileInfoPayload(info: FileInfo): FileInfoPayload {
  return {
    name: info.name,
    path: info.path,
    type: info.type,
    size: info.size,
    ...(info.tokenEstimate !== undefined
      ? { tokenEstimate: info.tokenEstimate }
      : {}),
    created: info.created.toISOString(),
    modified: info.modified.toISOString(),
    accessed: info.accessed.toISOString(),
    permissions: info.permissions,
    isHidden: info.isHidden,
    ...(info.mimeType !== undefined ? { mimeType: info.mimeType } : {}),
    ...(info.symlinkTarget !== undefined
      ? { symlinkTarget: info.symlinkTarget }
      : {}),
  };
}

function formatFileInfoDetails(info: FileInfo): string {
  const lines = [
    `${info.name} (${info.type})`,
    `  Path: ${info.path}`,
    `  Size: ${formatBytes(info.size)}`,
    `  Modified: ${info.modified.toISOString()}`,
  ];

  if (info.mimeType) lines.push(`  Type: ${info.mimeType}`);
  if (info.symlinkTarget) lines.push(`  Target: ${info.symlinkTarget}`);

  return joinLines(lines);
}

async function handleGetFileInfo(
  args: z.infer<typeof GetFileInfoInputSchema>,
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof GetFileInfoOutputSchema>>> {
  const info = await getFileInfo(args.path, {
    includeMimeType: true,
    ...(signal ? { signal } : {}),
  });

  const structured: z.infer<typeof GetFileInfoOutputSchema> = {
    ok: true,
    info: buildFileInfoPayload(info),
  };

  return buildToolResponse(formatFileInfoDetails(info), structured);
}

export function registerGetFileInfoTool(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  const handler = (
    args: z.infer<typeof GetFileInfoInputSchema>,
    extra: ToolExtra
  ): Promise<ToolResult<z.infer<typeof GetFileInfoOutputSchema>>> =>
    withToolDiagnostics(
      'stat',
      () =>
        withToolErrorHandling(
          async () => {
            const { signal, cleanup } = createTimedAbortSignal(
              extra.signal,
              DEFAULT_SEARCH_TIMEOUT_MS
            );
            try {
              return await handleGetFileInfo(args, signal);
            } finally {
              cleanup();
            }
          },
          (error) =>
            buildToolErrorResponse(error, ErrorCode.E_NOT_FOUND, args.path)
        ),
      { path: args.path }
    );

  server.registerTool(
    'stat',
    {
      ...GET_FILE_INFO_TOOL,
      ...(options.serverIcon
        ? {
            icons: [
              {
                src: options.serverIcon,
                mimeType: 'image/svg+xml',
                sizes: ['any'],
              },
            ],
          }
        : {}),
    },
    wrapToolHandler(handler, { guard: options.isInitialized })
  );
}
