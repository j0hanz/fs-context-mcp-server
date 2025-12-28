import { expect, it } from 'vitest';

import { ErrorCode, McpError } from '../../lib/errors.js';
import { assertLineRangeOptions } from '../../lib/line-range.js';

function expectMcpError(
  fn: () => void,
  options: { code: ErrorCode; messageIncludes: string }
): void {
  try {
    fn();
    expect.fail('Expected McpError to be thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(McpError);
    const mcpError = error as McpError;
    expect(mcpError.code).toBe(options.code);
    expect(mcpError.message).toContain(options.messageIncludes);
  }
}

function validateLineRange(params: {
  lineStart?: number;
  lineEnd?: number;
  head?: number;
  tail?: number;
  path: string;
}): void {
  const { path, ...options } = params;
  assertLineRangeOptions(options, path);
}

function validateHeadTail(head?: number, tail?: number): void {
  assertLineRangeOptions({ head, tail }, '/test/file.txt');
}

const validLineRangeCases = [
  {
    name: 'valid lineRange with both lineStart and lineEnd',
    params: { lineStart: 1, lineEnd: 10, path: '/test/file.txt' },
  },
  {
    name: 'no line options',
    params: { path: '/test/file.txt' },
  },
  {
    name: 'head option alone',
    params: { head: 10, path: '/test/file.txt' },
  },
  {
    name: 'tail option alone',
    params: { tail: 10, path: '/test/file.txt' },
  },
  {
    name: 'lineEnd equal to lineStart',
    params: { lineStart: 5, lineEnd: 5, path: '/test/file.txt' },
  },
];

for (const testCase of validLineRangeCases) {
  it(`validateLineRange accepts ${testCase.name}`, () => {
    expect(() => {
      validateLineRange(testCase.params);
    }).not.toThrow();
  });
}

const invalidLineRangeCases = [
  {
    name: 'lineStart without lineEnd',
    params: { lineStart: 5, path: '/test/file.txt' },
    message: 'lineStart requires lineEnd',
  },
  {
    name: 'lineEnd without lineStart',
    params: { lineEnd: 10, path: '/test/file.txt' },
    message: 'lineEnd requires lineStart',
  },
  {
    name: 'lineEnd < lineStart',
    params: { lineStart: 10, lineEnd: 5, path: '/test/file.txt' },
    message: 'lineEnd (5) must be >= lineStart (10)',
  },
  {
    name: 'lineRange with head',
    params: { lineStart: 1, lineEnd: 10, head: 5, path: '/test/file.txt' },
    message: 'Cannot specify multiple',
  },
  {
    name: 'lineRange with tail',
    params: { lineStart: 1, lineEnd: 10, tail: 5, path: '/test/file.txt' },
    message: 'Cannot specify multiple',
  },
  {
    name: 'head with tail',
    params: { head: 5, tail: 5, path: '/test/file.txt' },
    message: 'Cannot specify multiple',
  },
];

for (const testCase of invalidLineRangeCases) {
  it(`validateLineRange rejects ${testCase.name}`, () => {
    expectMcpError(
      () => {
        validateLineRange(testCase.params);
      },
      {
        code: ErrorCode.E_INVALID_INPUT,
        messageIncludes: testCase.message,
      }
    );
  });
}

const validHeadTailCases: [number | undefined, number | undefined][] = [
  [10, undefined],
  [undefined, 10],
  [undefined, undefined],
];

for (const [head, tail] of validHeadTailCases) {
  it('validateHeadTail accepts valid head/tail combination', () => {
    expect(() => {
      validateHeadTail(head, tail);
    }).not.toThrow();
  });
}

it('validateHeadTail rejects both head and tail', () => {
  expectMcpError(
    () => {
      validateHeadTail(5, 5);
    },
    {
      code: ErrorCode.E_INVALID_INPUT,
      messageIncludes: 'Cannot specify multiple',
    }
  );
});
