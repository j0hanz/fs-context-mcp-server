import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { withAllToolsFixture } from '../shared/diagnostics-env.js';

void describe('find tool', () => {
  withAllToolsFixture((getHandler, getTestDir) => {
    void it('returns a clear empty-state message when no matches', async () => {
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
