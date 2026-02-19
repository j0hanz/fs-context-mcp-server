import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

import { type IconInfo, withDefaultIcons } from './tools/shared.js';

const HELP_PROMPT_NAME = 'get-help';
const HELP_PROMPT_TITLE = 'Get Help';
const HELP_PROMPT_DESCRIPTION = 'Return the filesystem-mcp usage instructions.';

export function registerGetHelpPrompt(
  server: McpServer,
  instructions: string,
  iconInfo?: IconInfo
): void {
  server.registerPrompt(
    HELP_PROMPT_NAME,
    withDefaultIcons(
      {
        title: HELP_PROMPT_TITLE,
        description: HELP_PROMPT_DESCRIPTION,
      },
      iconInfo
    ),
    (): GetPromptResult => ({
      description: HELP_PROMPT_DESCRIPTION,
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
