import assert from 'node:assert/strict';
import { it } from 'node:test';

import { ErrorCode } from '../../lib/errors.js';
import { ToolErrorResponseSchema } from '../../schemas.js';
import { buildToolErrorResponse, buildToolResponse } from '../../tools.js';

void it('buildToolResponse includes JSON content matching structuredContent', () => {
  const structured = { ok: true, value: 123 };
  const result = buildToolResponse('human text', structured);

  assert.ok(result.content.length >= 2);
  const jsonContent = result.content[result.content.length - 1];
  assert.ok(jsonContent);
  assert.deepStrictEqual(
    JSON.parse((jsonContent as { text: string }).text),
    structured
  );
  assert.deepStrictEqual(result.structuredContent, structured);
});

void it('buildToolErrorResponse includes JSON content matching structuredContent', () => {
  const result = buildToolErrorResponse(
    new Error('boom'),
    ErrorCode.E_UNKNOWN,
    '/path'
  );

  assert.strictEqual(result.isError, true);
  assert.ok(result.content.length >= 2);

  const jsonContent = result.content[result.content.length - 1];
  assert.ok(jsonContent);
  const parsed = JSON.parse((jsonContent as { text: string }).text) as unknown;
  assert.deepStrictEqual(parsed, result.structuredContent);

  // Validate against schema
  const validation = ToolErrorResponseSchema.safeParse(
    result.structuredContent
  );
  assert.strictEqual(validation.success, true);
});
