import assert from 'node:assert/strict';
import { it } from 'node:test';

import { ErrorCode, McpError } from '../../lib/errors.js';
import { createInMemoryResourceStore } from '../../lib/resource-store.js';

void it('evicts oldest entries when maxEntries exceeded', () => {
  const store = createInMemoryResourceStore({
    maxEntries: 2,
    maxTotalBytes: 1024,
    maxEntryBytes: 1024,
  });

  const first = store.putText({ name: 'a', text: 'one' });
  const second = store.putText({ name: 'b', text: 'two' });
  const third = store.putText({ name: 'c', text: 'three' });

  assert.ok(third.uri);
  assert.throws(
    () => store.getText(first.uri),
    (error) => error instanceof McpError && error.code === ErrorCode.E_NOT_FOUND
  );
  assert.deepStrictEqual(store.getText(second.uri).text, 'two');
  assert.deepStrictEqual(store.getText(third.uri).text, 'three');
});

void it('rejects entries larger than maxEntryBytes', () => {
  const store = createInMemoryResourceStore({
    maxEntries: 5,
    maxTotalBytes: 1024,
    maxEntryBytes: 4,
  });

  assert.throws(
    () => store.putText({ name: 'big', text: '12345' }),
    (error) => error instanceof McpError && error.code === ErrorCode.E_TOO_LARGE
  );
});
