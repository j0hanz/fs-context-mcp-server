import { describe, expect, it } from 'vitest';

import {
  classifyError,
  createDetailedError,
  ErrorCode,
  formatDetailedError,
  getSuggestion,
  isNodeError,
  McpError,
  NODE_ERROR_CODE_MAP,
} from '../../lib/errors.js';

describe('Error Utilities', () => {
  describe('isNodeError', () => {
    it('should return true for Node.js ErrnoException', () => {
      const error = Object.assign(new Error('test'), { code: 'ENOENT' });
      expect(isNodeError(error)).toBe(true);
    });

    it('should return false for regular Error without code', () => {
      const error = new Error('test');
      expect(isNodeError(error)).toBe(false);
    });

    it('should return false for non-Error objects', () => {
      expect(isNodeError('string')).toBe(false);
      expect(isNodeError({ code: 'ENOENT' })).toBe(false);
      expect(isNodeError(null)).toBe(false);
      expect(isNodeError(undefined)).toBe(false);
    });

    it('should return false for Error with non-string code', () => {
      const error = Object.assign(new Error('test'), { code: 123 });
      expect(isNodeError(error)).toBe(false);
    });
  });

  describe('NODE_ERROR_CODE_MAP', () => {
    it('should map common Node.js error codes', () => {
      expect(NODE_ERROR_CODE_MAP.ENOENT).toBe(ErrorCode.E_NOT_FOUND);
      expect(NODE_ERROR_CODE_MAP.EACCES).toBe(ErrorCode.E_PERMISSION_DENIED);
      expect(NODE_ERROR_CODE_MAP.EPERM).toBe(ErrorCode.E_PERMISSION_DENIED);
      expect(NODE_ERROR_CODE_MAP.EISDIR).toBe(ErrorCode.E_NOT_FILE);
      expect(NODE_ERROR_CODE_MAP.ENOTDIR).toBe(ErrorCode.E_NOT_DIRECTORY);
      expect(NODE_ERROR_CODE_MAP.ELOOP).toBe(ErrorCode.E_SYMLINK_NOT_ALLOWED);
      expect(NODE_ERROR_CODE_MAP.ETIMEDOUT).toBe(ErrorCode.E_TIMEOUT);
    });

    it('should handle resource exhaustion errors as timeout', () => {
      expect(NODE_ERROR_CODE_MAP.EMFILE).toBe(ErrorCode.E_TIMEOUT);
      expect(NODE_ERROR_CODE_MAP.ENFILE).toBe(ErrorCode.E_TIMEOUT);
    });
  });

  describe('classifyError', () => {
    it('should classify ENOENT messages as not found', () => {
      const error = new Error('ENOENT: no such file or directory');
      expect(classifyError(error)).toBe(ErrorCode.E_NOT_FOUND);
    });

    it('should return unknown for unrecognized message-only errors', () => {
      const error = new Error('Some random error');
      expect(classifyError(error)).toBe(ErrorCode.E_UNKNOWN);
    });

    it('should handle non-Error objects', () => {
      expect(classifyError('ENOENT error')).toBe(ErrorCode.E_NOT_FOUND);
      expect(classifyError({ message: 'permission denied' })).toBe(
        ErrorCode.E_UNKNOWN
      );
    });

    it('should classify Node.js EACCES error code', () => {
      const error = Object.assign(new Error('permission denied'), {
        code: 'EACCES',
      });
      expect(classifyError(error)).toBe(ErrorCode.E_PERMISSION_DENIED);
    });

    it('should classify Node.js EPERM error code', () => {
      const error = Object.assign(new Error('operation not permitted'), {
        code: 'EPERM',
      });
      expect(classifyError(error)).toBe(ErrorCode.E_PERMISSION_DENIED);
    });

    it('should classify Node.js EISDIR error code', () => {
      const error = Object.assign(new Error('is a directory'), {
        code: 'EISDIR',
      });
      expect(classifyError(error)).toBe(ErrorCode.E_NOT_FILE);
    });

    it('should classify Node.js ENOTDIR error code', () => {
      const error = Object.assign(new Error('not a directory'), {
        code: 'ENOTDIR',
      });
      expect(classifyError(error)).toBe(ErrorCode.E_NOT_DIRECTORY);
    });

    it('should classify Node.js ELOOP error code', () => {
      const error = Object.assign(new Error('too many symbolic links'), {
        code: 'ELOOP',
      });
      expect(classifyError(error)).toBe(ErrorCode.E_SYMLINK_NOT_ALLOWED);
    });

    it('should classify Node.js ETIMEDOUT error code', () => {
      const error = Object.assign(new Error('operation timed out'), {
        code: 'ETIMEDOUT',
      });
      expect(classifyError(error)).toBe(ErrorCode.E_TIMEOUT);
    });

    it('should classify McpError directly by its code', () => {
      const error = new McpError(
        ErrorCode.E_TOO_LARGE,
        'File too large',
        '/path/to/file'
      );
      expect(classifyError(error)).toBe(ErrorCode.E_TOO_LARGE);
    });
  });

  describe('McpError', () => {
    it('should create error with all properties', () => {
      const error = new McpError(
        ErrorCode.E_ACCESS_DENIED,
        'Access denied',
        '/some/path',
        { extra: 'detail' }
      );

      expect(error.code).toBe(ErrorCode.E_ACCESS_DENIED);
      expect(error.message).toBe('Access denied');
      expect(error.path).toBe('/some/path');
      expect(error.details).toEqual({ extra: 'detail' });
      expect(error.name).toBe('McpError');
    });

    it('should support cause chaining', () => {
      const cause = new Error('Original error');
      const error = new McpError(
        ErrorCode.E_NOT_FOUND,
        'File not found',
        '/path',
        undefined,
        cause
      );

      expect(error.cause).toBe(cause);
    });

    it('should be instanceof Error', () => {
      const error = new McpError(ErrorCode.E_UNKNOWN, 'Test');
      expect(error instanceof Error).toBe(true);
      expect(error instanceof McpError).toBe(true);
    });

    it('should create from existing error with fromError', () => {
      const original = new Error('Original');
      original.stack = 'Original stack trace';

      const mcpError = McpError.fromError(
        ErrorCode.E_NOT_FOUND,
        'Wrapped error',
        original,
        '/path'
      );

      expect(mcpError.code).toBe(ErrorCode.E_NOT_FOUND);
      expect(mcpError.cause).toBe(original);
      expect(mcpError.stack).toContain('Caused by: Original stack trace');
    });
  });

  describe('createDetailedError', () => {
    it('should create detailed error object', () => {
      const error = new McpError(
        ErrorCode.E_NOT_FOUND,
        'File not found',
        '/some/path'
      );
      const detailed = createDetailedError(error, '/some/path');

      expect(detailed.code).toBe(ErrorCode.E_NOT_FOUND);
      expect(detailed.message).toBe('File not found');
      expect(detailed.path).toBe('/some/path');
      expect(detailed.suggestion).toBeTruthy();
    });

    it('should include additional details', () => {
      const error = new Error('Error');
      const detailed = createDetailedError(error, '/path', { extra: 'info' });

      expect(detailed.details).toEqual({ extra: 'info' });
    });
  });

  describe('formatDetailedError', () => {
    it('should format error for display', () => {
      const detailed = {
        code: ErrorCode.E_NOT_FOUND,
        message: 'File not found',
        path: '/some/path',
        suggestion: 'Check the path exists',
      };

      const formatted = formatDetailedError(detailed);

      expect(formatted).toContain('E_NOT_FOUND');
      expect(formatted).toContain('File not found');
      expect(formatted).toContain('/some/path');
      expect(formatted).toContain('Check the path exists');
    });

    it('should handle missing optional fields', () => {
      const detailed = {
        code: ErrorCode.E_UNKNOWN,
        message: 'Unknown error',
      };

      const formatted = formatDetailedError(detailed);

      expect(formatted).toContain('E_UNKNOWN');
      expect(formatted).toContain('Unknown error');
    });
  });

  describe('getSuggestion', () => {
    it('should return suggestions for all error codes', () => {
      const errorCodes = Object.values(ErrorCode);

      for (const code of errorCodes) {
        const suggestion = getSuggestion(code);
        expect(suggestion).toBeTruthy();
        expect(typeof suggestion).toBe('string');
      }
    });
  });
});
