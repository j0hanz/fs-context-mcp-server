import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

import { ErrorCode, McpError } from './lib/errors.js';
import type { ResourceStore } from './lib/resource-store.js';
import type { IconInfo } from './tools/shared.js';

const RESULT_TEMPLATE = new ResourceTemplate('filesystem-mcp://result/{id}', {
  list: undefined,
});

export function registerInstructionResource(
  server: McpServer,
  instructions: string,
  iconInfo?: IconInfo
): void {
  server.registerResource(
    'filesystem-mcp-instructions',
    'internal://instructions',
    {
      title: 'Server Instructions',
      description:
        'Guidance for using the filesystem-mcp MCP tools effectively.',
      mimeType: 'text/markdown',
      annotations: {
        audience: ['assistant'],
        priority: 0.8,
      },
      ...(iconInfo
        ? {
            icons: [
              {
                src: iconInfo.src,
                mimeType: iconInfo.mimeType,
              },
            ],
          }
        : {}),
    },
    (uri): ReadResourceResult => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: instructions,
        },
      ],
    })
  );
}

export function registerResultResources(
  server: McpServer,
  store: ResourceStore,
  iconInfo?: IconInfo
): void {
  server.registerResource(
    'filesystem-mcp-result',
    RESULT_TEMPLATE,
    {
      title: 'Cached Tool Result',
      description:
        'Ephemeral cached tool output exposed as an MCP resource. Not guaranteed to be listed via resources/list.',
      mimeType: 'text/plain',
      annotations: {
        audience: ['assistant'],
        priority: 0.3,
      },
      ...(iconInfo
        ? {
            icons: [
              {
                src: iconInfo.src,
                mimeType: iconInfo.mimeType,
              },
            ],
          }
        : {}),
    },
    (uri, variables): ReadResourceResult => {
      const { id } = variables;
      if (typeof id !== 'string' || id.length === 0) {
        throw new McpError(ErrorCode.E_INVALID_INPUT, 'Missing resource id');
      }

      const entry = store.getText(uri.toString());

      return {
        contents: [
          {
            uri: entry.uri,
            mimeType: entry.mimeType,
            text: entry.text,
          },
        ],
      };
    }
  );
}
