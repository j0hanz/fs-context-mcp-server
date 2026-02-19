import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

import { type IconInfo, withDefaultIcons } from './tools/shared.js';

export function registerGetHelpPrompt(
  server: McpServer,
  instructions: string,
  iconInfo?: IconInfo
): void {
  const description = 'Return the filesystem-mcp usage instructions.';

  server.registerPrompt(
    'get-help',
    withDefaultIcons(
      {
        title: 'Get Help',
        description,
      },
      iconInfo
    ),
    (): GetPromptResult => ({
      description,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: instructions,
          },
        },
      ],
    })
  );
}
