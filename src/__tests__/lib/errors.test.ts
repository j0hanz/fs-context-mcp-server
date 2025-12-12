import { describe, expect, it } from 'vitest';

import {
  classifyError,
  createDetailedError,
  ErrorCode,
  formatDetailedError,
  getSuggestion,
  McpError,
} from '../../lib/errors.js';

describe('Error Utilities', () => {
  describe('classifyError', () => {
    it('should classify access denied errors', () => {
      const error = new Error('Path not within allowed directories');
      expect(classifyError(error)).toBe(ErrorCode.E_ACCESS_DENIED);
    });

    it('should classify not found errors', () => {
      const error = new Error('ENOENT: no such file or directory');
      expect(classifyError(error)).toBe(ErrorCode.E_NOT_FOUND);
    });

    it('should classify not a file errors', () => {
      const error = new Error('Not a file: /some/path');
      expect(classifyError(error)).toBe(ErrorCode.E_NOT_FILE);
    });

    it('should classify file too large errors', () => {
      const error = new Error('File too large: 100MB');
      expect(classifyError(error)).toBe(ErrorCode.E_TOO_LARGE);
    });

    it('should classify permission errors', () => {
      const error = new Error('EACCES: permission denied');
      expect(classifyError(error)).toBe(ErrorCode.E_PERMISSION_DENIED);
    });

    it('should classify timeout errors', () => {
      const error = new Error('Operation timeout');
      expect(classifyError(error)).toBe(ErrorCode.E_TIMEOUT);
    });

    it('should return unknown for unrecognized errors', () => {
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
      const error = new Error('File not found');
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
