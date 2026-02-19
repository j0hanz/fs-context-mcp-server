import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

import { ErrorCode, McpError } from './lib/errors.js';
import type { ResourceStore } from './lib/resource-store.js';
import { type IconInfo, withDefaultIcons } from './tools/shared.js';

const RESULT_TEMPLATE = new ResourceTemplate('filesystem-mcp://result/{id}', {
  list: undefined,
});
const INSTRUCTIONS_RESOURCE_NAME = 'filesystem-mcp-instructions';
const INSTRUCTIONS_RESOURCE_URI = 'internal://instructions';
const INSTRUCTIONS_RESOURCE_DESCRIPTION =
  'Guidance for using the filesystem-mcp MCP tools effectively.';
const RESULT_RESOURCE_NAME = 'filesystem-mcp-result';
const RESULT_RESOURCE_DESCRIPTION =
  'Ephemeral cached tool output exposed as an MCP resource. Not guaranteed to be listed via resources/list.';

export function registerInstructionResource(
  server: McpServer,
  instructions: string,
  iconInfo?: IconInfo
): void {
  server.registerResource(
    INSTRUCTIONS_RESOURCE_NAME,
    INSTRUCTIONS_RESOURCE_URI,
    withDefaultIcons(
      {
        title: 'Server Instructions',
        description: INSTRUCTIONS_RESOURCE_DESCRIPTION,
        mimeType: 'text/markdown',
        annotations: {
          audience: ['assistant'],
          priority: 0.8,
        },
      },
      iconInfo
    ),
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
    RESULT_RESOURCE_NAME,
    RESULT_TEMPLATE,
    withDefaultIcons(
      {
        title: 'Cached Tool Result',
        description: RESULT_RESOURCE_DESCRIPTION,
        mimeType: 'text/plain',
        annotations: {
          audience: ['assistant'],
          priority: 0.3,
        },
      },
      iconInfo
    ),
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
