import assert from 'node:assert/strict';
import { it } from 'node:test';

import { isSensitivePath } from '../../lib/path-policy.js';

void it('flags common secret filenames as sensitive', () => {
  assert.strictEqual(isSensitivePath('.env'), true);
  assert.strictEqual(isSensitivePath('.env.local'), true);
  assert.strictEqual(isSensitivePath('.npmrc'), true);
});

void it('flags token patterns as sensitive', () => {
  assert.strictEqual(isSensitivePath('.mcpregistry_registry_token'), true);
});

void it('does not flag ordinary source files', () => {
  assert.strictEqual(isSensitivePath('src/index.ts'), false);
});
