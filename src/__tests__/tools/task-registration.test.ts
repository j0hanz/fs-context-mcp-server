import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerAllTools } from '../../tools.js';

await it('registers optional task handlers for long-running tools', async () => {
  const taskToolNames = new Set<string>();

  const fakeServer = {
    registerTool: (_name: string, _definition: unknown, _handler: unknown) => {
      // no-op
    },
    experimental: {
      tasks: {
        registerToolTask: (name: string) => {
          taskToolNames.add(name);
        },
      },
    },
  } as unknown as McpServer;

  registerAllTools(fakeServer);

  const expectedTaskTools = [
    'find',
    'grep',
    'search_and_replace',
    'tree',
    'read_many',
    'stat_many',
  ];

  for (const toolName of expectedTaskTools) {
    assert.ok(
      taskToolNames.has(toolName),
      `Expected task-capable tool registration for ${toolName}`
    );
  }
});
