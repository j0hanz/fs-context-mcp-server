import { describe, expect, it } from 'vitest';

import { ErrorCode, McpError } from '../../lib/errors.js';
import {
  validateHeadTail,
  validateLineRange,
} from '../../schemas/validators.js';

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
      validateHeadTail({ head: 10 });
    }).not.toThrow();
  });

  it('should accept tail alone', () => {
    expect(() => {
      validateHeadTail({ tail: 10 });
    }).not.toThrow();
  });

  it('should accept neither head nor tail', () => {
    expect(() => {
      validateHeadTail({});
    }).not.toThrow();
  });

  it('should reject both head and tail', () => {
    try {
      validateHeadTail({ head: 5, tail: 5 });
      expect.fail('Expected McpError to be thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(McpError);
      const mcpError = error as McpError;
      expect(mcpError.code).toBe(ErrorCode.E_INVALID_INPUT);
      expect(mcpError.message).toContain('Cannot specify both head and tail');
    }
  });
});
