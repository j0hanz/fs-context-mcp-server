import * as path from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { withAllToolsFixture } from '../shared/diagnostics-env.js';

void describe('grep tool pattern semantics', () => {
  withAllToolsFixture((getHandler, getTestDir) => {
    void it('treats pattern as literal by default', async () => {
      const grep = getHandler('grep');
      const filePath = path.join(getTestDir(), 'src', 'index.ts');

      // This is a regex pattern, but literal mode should NOT match it.
      const result = (await grep(
        {
          path: filePath,
          pattern: 'hello\\s*=\\s*"world"',
          includeHidden: false,
        },
        {}
      )) as { structuredContent?: unknown };

      const structured = result.structuredContent as {
        ok: boolean;
        matches?: unknown[];
        totalMatches?: number;
        patternType?: string;
        caseSensitive?: boolean;
      };

      assert.equal(structured.ok, true);
      assert.equal(Array.isArray(structured.matches), true);
      assert.equal(structured.matches?.length ?? -1, 0);
      assert.equal(structured.totalMatches ?? -1, 0);
      assert.equal(structured.patternType, 'literal');
      assert.equal(structured.caseSensitive, false);
    });

    void it('enables regex matching when isRegex=true', async () => {
      const grep = getHandler('grep');
      const filePath = path.join(getTestDir(), 'src', 'index.ts');

      const result = (await grep(
        {
          path: filePath,
          pattern: 'hello\\s*=\\s*"world"',
          isRegex: true,
          includeHidden: false,
        },
        {}
      )) as { structuredContent?: unknown };

      const structured = result.structuredContent as {
        ok: boolean;
        matches?: Array<{ file: string; line: number; content: string }>;
        totalMatches?: number;
        patternType?: string;
        caseSensitive?: boolean;
      };

      assert.equal(structured.ok, true);
      assert.ok((structured.matches?.length ?? 0) >= 1);
      assert.ok((structured.totalMatches ?? 0) >= 1);
      assert.equal(structured.patternType, 'regex');
      assert.equal(structured.caseSensitive, false);
      const first = structured.matches?.[0];
      assert.ok(first);
      assert.equal(typeof first.file, 'string');
      assert.equal(typeof first.line, 'number');
      assert.equal(typeof first.content, 'string');
    });
  });
});
