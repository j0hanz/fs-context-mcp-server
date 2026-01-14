import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { withAllToolsFixture } from '../shared/diagnostics-env.js';

void describe('find tool', () => {
  withAllToolsFixture((getHandler, getTestDir) => {
    void it('includes truncation marker in text output when truncated', async () => {
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
