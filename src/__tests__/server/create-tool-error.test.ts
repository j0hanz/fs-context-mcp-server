import assert from 'node:assert/strict';
import { it } from 'node:test';

import { ErrorCode } from '../../lib/errors.js';
import { createServer } from '../../server.js';

function getCreateToolError(server: unknown): (message: string) => unknown {
  return (server as { createToolError: (message: string) => unknown })
    .createToolError;
}

function getErrorCode(result: unknown): string | undefined {
  const structured = (result as { structuredContent?: unknown })
    .structuredContent as
    | {
        ok?: boolean;
        error?: { code?: string };
      }
    | undefined;
  return structured?.error?.code;
}

void it('createToolError preserves explicit ErrorCode tokens in the message', async () => {
  const server = await createServer();
  const createToolError = getCreateToolError(server);

  const result = createToolError(
    'E_ACCESS_DENIED: no workspace roots configured'
  );
  assert.strictEqual(getErrorCode(result), ErrorCode.E_ACCESS_DENIED);
});

void it('createToolError maps validation-ish messages to E_INVALID_INPUT', async () => {
  const server = await createServer();
  const createToolError = getCreateToolError(server);

  const result = createToolError('Input validation failed: unknown field');
  assert.strictEqual(getErrorCode(result), ErrorCode.E_INVALID_INPUT);
});

void it('createToolError maps timeouts to E_TIMEOUT', async () => {
  const server = await createServer();
  const createToolError = getCreateToolError(server);

  const result = createToolError('Operation timed out');
  assert.strictEqual(getErrorCode(result), ErrorCode.E_TIMEOUT);
});
