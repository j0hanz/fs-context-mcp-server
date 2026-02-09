import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

export function registerGetHelpPrompt(
  server: McpServer,
  instructions: string
): void {
  const description = 'Return the fs-context usage instructions.';

  server.registerPrompt(
    'get-help',
    {
      title: 'Get Help',
      description,
    },
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
