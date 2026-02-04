import assert from 'node:assert/strict';
import { it } from 'node:test';

import { ErrorCode } from '../../lib/errors.js';
import { registerListDirectoryTool } from '../../tools/list-directory.js';
import { createSingleToolCapture } from '../shared/diagnostics-env.js';

void it('rejects tool calls before notifications/initialized', async () => {
  const { fakeServer, getHandler } = createSingleToolCapture();
  registerListDirectoryTool(fakeServer, { isInitialized: () => false });

  const handler = getHandler();
  const result = await handler({});

  const typed = result as {
    isError?: boolean;
    structuredContent?: {
      ok?: boolean;
      error?: { code?: string; message?: string };
    };
  };

  assert.strictEqual(typed.isError, true);
  assert.strictEqual(typed.structuredContent?.ok, false);
  assert.strictEqual(
    typed.structuredContent?.error?.code,
    ErrorCode.E_INVALID_INPUT
  );
  assert.match(
    typed.structuredContent?.error?.message ?? '',
    /notifications\/initialized/i
  );
});
