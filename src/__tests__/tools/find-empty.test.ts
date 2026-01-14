import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerAllTools } from '../../tools.js';
import { withFileOpsFixture } from '../lib/fixtures/file-ops-hooks.js';

type ToolHandler = (args?: unknown, extra?: unknown) => Promise<unknown>;

function createFakeServerCapture(): {
  fakeServer: McpServer;
  getHandler: (name: string) => ToolHandler;
} {
  const handlers = new Map<string, ToolHandler>();

  const fakeServer = {
    registerTool: (name: string, _definition: unknown, handler: unknown) => {
      handlers.set(name, handler as ToolHandler);
    },
  } as const;

  return {
    fakeServer: fakeServer as unknown as McpServer,
    getHandler: (name: string) => {
      const handler = handlers.get(name);
      assert.ok(handler, `Expected tool handler to be registered: ${name}`);
      return handler;
    },
  };
}

void describe('find tool', () => {
  withFileOpsFixture((getTestDir) => {
    void it('returns a clear empty-state message when no matches', async () => {
      const { fakeServer, getHandler } = createFakeServerCapture();
      registerAllTools(fakeServer);

      const handler = getHandler('find');
      const result = (await handler(
        {
          path: getTestDir(),
          pattern: '**/*.definitely-does-not-exist',
          maxResults: 100,
          includeIgnored: true,
        },
        {}
      )) as {
        content?: { type?: unknown; text?: unknown }[];
      };

      const text = result.content?.[0]?.text;
      assert.strictEqual(text, 'No matches');
    });
  });
});
