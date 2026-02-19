import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';

import {
  maybeStripStructuredContentFromResult,
  shouldStripStructuredOutput,
  withDefaultIcons,
} from '../../tools/shared.js';

const originalStripEnv = process.env['FS_CONTEXT_STRIP_STRUCTURED'];

afterEach(() => {
  if (originalStripEnv === undefined) {
    delete process.env['FS_CONTEXT_STRIP_STRUCTURED'];
    return;
  }
  process.env['FS_CONTEXT_STRIP_STRUCTURED'] = originalStripEnv;
});

void it('shouldStripStructuredOutput parses known true values', () => {
  process.env['FS_CONTEXT_STRIP_STRUCTURED'] = 'yes';
  assert.strictEqual(shouldStripStructuredOutput(), true);
  process.env['FS_CONTEXT_STRIP_STRUCTURED'] = 'TRUE';
  assert.strictEqual(shouldStripStructuredOutput(), true);
  process.env['FS_CONTEXT_STRIP_STRUCTURED'] = '1';
  assert.strictEqual(shouldStripStructuredOutput(), true);
});

void it('maybeStripStructuredContentFromResult removes structuredContent when enabled', () => {
  process.env['FS_CONTEXT_STRIP_STRUCTURED'] = 'true';
  const result = maybeStripStructuredContentFromResult({
    content: [{ type: 'text' as const, text: 'ok' }],
    structuredContent: { ok: true },
    isError: false,
  });
  assert.strictEqual(Object.hasOwn(result, 'structuredContent'), false);
  assert.strictEqual(Object.hasOwn(result, 'content'), true);
});

void it('withDefaultIcons strips outputSchema when enabled', () => {
  process.env['FS_CONTEXT_STRIP_STRUCTURED'] = 'true';
  const tool = withDefaultIcons(
    {
      title: 'Example',
      description: 'example',
      inputSchema: {},
      outputSchema: { type: 'object' },
    },
    undefined
  ) as Record<string, unknown>;
  assert.strictEqual(Object.hasOwn(tool, 'outputSchema'), false);
});

void it('withDefaultIcons keeps outputSchema when disabled', () => {
  delete process.env['FS_CONTEXT_STRIP_STRUCTURED'];
  const tool = withDefaultIcons(
    {
      title: 'Example',
      description: 'example',
      inputSchema: {},
      outputSchema: { type: 'object' },
    },
    undefined
  ) as Record<string, unknown>;
  assert.strictEqual(Object.hasOwn(tool, 'outputSchema'), true);
});
