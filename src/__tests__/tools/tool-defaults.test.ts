import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ErrorCode } from '../../lib/errors.js';
import {
  getAllowedDirectories,
  setAllowedDirectoriesResolved,
} from '../../lib/path-validation.js';
import {
  ListDirectoryInputSchema,
  SearchContentInputSchema,
  SearchFilesInputSchema,
} from '../../schemas.js';
import { registerListDirectoryTool } from '../../tools.js';

type ToolHandler = (args?: unknown, extra?: unknown) => Promise<unknown>;

function createFakeServerCapture(): {
  fakeServer: McpServer;
  getHandler: () => ToolHandler;
} {
  let captured: ToolHandler | undefined;
  const fakeServer = {
    registerTool: (_name: string, _definition: unknown, handler: unknown) => {
      captured = handler as ToolHandler;
    },
  } as const;

  return {
    fakeServer: fakeServer as unknown as McpServer,
    getHandler: () => {
      assert.ok(captured);
      return captured;
    },
  };
}

void it('grep includes includeHidden=false by default', () => {
  const parsed = SearchContentInputSchema.parse({ pattern: 'console.log' });
  assert.strictEqual(parsed.includeHidden, false);
});

void it('grep rejects unknown parameters', () => {
  assert.throws(
    () => SearchContentInputSchema.parse({ pattern: 'x', isLiteral: false }),
    /Unrecognized key/i
  );
});

void it('find includes includeIgnored=false by default', () => {
  const parsed = SearchFilesInputSchema.parse({ pattern: '**/*.ts' });
  assert.strictEqual(parsed.includeIgnored, false);
});

void it('ls includes includeHidden=false by default', () => {
  const parsed = ListDirectoryInputSchema.parse({});
  assert.strictEqual(parsed.includeHidden, false);
});

void it('ls rejects unknown parameters', () => {
  assert.throws(
    () => ListDirectoryInputSchema.parse({ pattern: '**/*' }),
    /Unrecognized key/i
  );
});

await it('ls returns E_ACCESS_DENIED when no roots configured', async () => {
  const previousAllowed = getAllowedDirectories();
  await setAllowedDirectoriesResolved([]);

  try {
    const { fakeServer, getHandler } = createFakeServerCapture();
    registerListDirectoryTool(fakeServer);
    const handler = getHandler();

    const result = (await handler({}, {})) as {
      isError?: unknown;
      structuredContent?: unknown;
    };

    assert.strictEqual(result.isError, true);
    assert.ok(
      typeof result.structuredContent === 'object' &&
        result.structuredContent !== null
    );

    const structured = result.structuredContent as {
      ok?: unknown;
      error?: { code?: unknown };
    };

    assert.strictEqual(structured.ok, false);
    assert.strictEqual(structured.error?.code, ErrorCode.E_ACCESS_DENIED);
  } finally {
    await setAllowedDirectoriesResolved(previousAllowed);
  }
});
