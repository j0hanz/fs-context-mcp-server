import { describe, expect, it } from 'vitest';

import { ErrorCode, McpError } from '../../lib/errors.js';

// Inline validation functions (matching the implementation in tools)
function validateLineRange(params: {
  lineStart?: number;
  lineEnd?: number;
  head?: number;
  tail?: number;
  path: string;
}): void {
  const { lineStart, lineEnd, head, tail, path } = params;
  const hasLineStart = lineStart !== undefined;
  const hasLineEnd = lineEnd !== undefined;

  if (hasLineStart !== hasLineEnd) {
    const missing = hasLineStart ? 'lineEnd' : 'lineStart';
    const provided = hasLineStart ? 'lineStart' : 'lineEnd';
    throw new McpError(
      ErrorCode.E_INVALID_INPUT,
      `Invalid lineRange: ${provided} requires ${missing} to also be specified`,
      path
    );
  }

  if (hasLineStart && hasLineEnd && lineEnd < lineStart) {
    throw new McpError(
      ErrorCode.E_INVALID_INPUT,
      `Invalid lineRange: lineEnd (${lineEnd}) must be >= lineStart (${lineStart})`,
      path
    );
  }

  const hasLineRange = hasLineStart && hasLineEnd;
  const optionsCount = [
    hasLineRange,
    head !== undefined,
    tail !== undefined,
  ].filter(Boolean).length;
  if (optionsCount > 1) {
    throw new McpError(
      ErrorCode.E_INVALID_INPUT,
      'Cannot specify multiple of lineRange (lineStart + lineEnd), head, or tail simultaneously',
      path
    );
  }
}

function validateHeadTail(head?: number, tail?: number): void {
  if (head !== undefined && tail !== undefined) {
    throw new McpError(
      ErrorCode.E_INVALID_INPUT,
      'Cannot specify both head and tail simultaneously'
    );
  }
}

describe('validateLineRange', () => {
  it('should accept valid lineRange with both lineStart and lineEnd', () => {
    expect(() => {
      validateLineRange({ lineStart: 1, lineEnd: 10, path: '/test/file.txt' });
    }).not.toThrow();
  });

  it('should accept when no line options are specified', () => {
    expect(() => {
      validateLineRange({ path: '/test/file.txt' });
    }).not.toThrow();
  });

  it('should accept head option alone', () => {
    expect(() => {
      validateLineRange({ head: 10, path: '/test/file.txt' });
    }).not.toThrow();
  });

  it('should accept tail option alone', () => {
    expect(() => {
      validateLineRange({ tail: 10, path: '/test/file.txt' });
    }).not.toThrow();
  });

  it('should reject lineStart without lineEnd', () => {
    try {
      validateLineRange({ lineStart: 5, path: '/test/file.txt' });
      expect.fail('Expected McpError to be thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(McpError);
      const mcpError = error as McpError;
      expect(mcpError.code).toBe(ErrorCode.E_INVALID_INPUT);
      expect(mcpError.message).toContain('lineStart requires lineEnd');
    }
  });

  it('should reject lineEnd without lineStart', () => {
    try {
      validateLineRange({ lineEnd: 10, path: '/test/file.txt' });
      expect.fail('Expected McpError to be thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(McpError);
      const mcpError = error as McpError;
      expect(mcpError.code).toBe(ErrorCode.E_INVALID_INPUT);
      expect(mcpError.message).toContain('lineEnd requires lineStart');
    }
  });

  it('should reject lineEnd < lineStart', () => {
    try {
      validateLineRange({ lineStart: 10, lineEnd: 5, path: '/test/file.txt' });
      expect.fail('Expected McpError to be thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(McpError);
      const mcpError = error as McpError;
      expect(mcpError.code).toBe(ErrorCode.E_INVALID_INPUT);
      expect(mcpError.message).toContain(
        'lineEnd (5) must be >= lineStart (10)'
      );
    }
  });

  it('should accept lineEnd equal to lineStart (single line)', () => {
    expect(() => {
      validateLineRange({ lineStart: 5, lineEnd: 5, path: '/test/file.txt' });
    }).not.toThrow();
  });

  it('should reject lineRange with head', () => {
    try {
      validateLineRange({
        lineStart: 1,
        lineEnd: 10,
        head: 5,
        path: '/test/file.txt',
      });
      expect.fail('Expected McpError to be thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(McpError);
      const mcpError = error as McpError;
      expect(mcpError.code).toBe(ErrorCode.E_INVALID_INPUT);
      expect(mcpError.message).toContain('Cannot specify multiple');
    }
  });

  it('should reject lineRange with tail', () => {
    try {
      validateLineRange({
        lineStart: 1,
        lineEnd: 10,
        tail: 5,
        path: '/test/file.txt',
      });
      expect.fail('Expected McpError to be thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(McpError);
      const mcpError = error as McpError;
      expect(mcpError.code).toBe(ErrorCode.E_INVALID_INPUT);
      expect(mcpError.message).toContain('Cannot specify multiple');
    }
  });

  it('should reject head with tail', () => {
    try {
      validateLineRange({ head: 5, tail: 5, path: '/test/file.txt' });
      expect.fail('Expected McpError to be thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(McpError);
      const mcpError = error as McpError;
      expect(mcpError.code).toBe(ErrorCode.E_INVALID_INPUT);
      expect(mcpError.message).toContain('Cannot specify multiple');
    }
  });
});

describe('validateHeadTail', () => {
  it('should accept head alone', () => {
    expect(() => {
      validateHeadTail(10, undefined);
    }).not.toThrow();
  });

  it('should accept tail alone', () => {
    expect(() => {
      validateHeadTail(undefined, 10);
    }).not.toThrow();
  });

  it('should accept neither head nor tail', () => {
    expect(() => {
      validateHeadTail(undefined, undefined);
    }).not.toThrow();
  });

  it('should reject both head and tail', () => {
    try {
      validateHeadTail(5, 5);
      expect.fail('Expected McpError to be thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(McpError);
      const mcpError = error as McpError;
      expect(mcpError.code).toBe(ErrorCode.E_INVALID_INPUT);
      expect(mcpError.message).toContain('Cannot specify both head and tail');
    }
  });
});
