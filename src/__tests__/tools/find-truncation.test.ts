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
    void it('includes truncation marker in text output when truncated', async () => {
      const { fakeServer, getHandler } = createFakeServerCapture();
      registerAllTools(fakeServer);

      const handler = getHandler('find');
      const result = (await handler(
        {
          path: getTestDir(),
          pattern: '**/*',
          maxResults: 1,
          includeIgnored: true,
        },
        {}
      )) as {
        content?: { type?: unknown; text?: unknown }[];
        structuredContent?: { truncated?: unknown };
      };

      const text = result.content?.[0]?.text;
      if (typeof text !== 'string') {
        assert.fail(
          `Expected text output to be a string, got: ${String(text)}`
        );
      }
      assert.ok(
        text.includes('[truncated:'),
        `Expected truncation marker in text output, got:\n${text}`
      );

      assert.strictEqual(result.structuredContent?.truncated, true);
    });
  });
});
