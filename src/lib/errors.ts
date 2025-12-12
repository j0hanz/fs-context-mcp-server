/**
 * Structured error handling utilities for consistent error responses
 */
import {
  type DetailedError,
  ErrorCode,
  type ErrorResponse,
} from '../config/types.js';

// Re-export ErrorCode from centralized location
export { ErrorCode };

export class McpError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public path?: string,
    public details?: Record<string, unknown>,
    cause?: unknown
  ) {
    super(message, { cause });
    this.name = 'McpError';
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, McpError.prototype);
  }

  /**
   * Create an McpError from an existing error with proper cause chaining
   */
  static fromError(
    code: ErrorCode,
    message: string,
    originalError: unknown,
    path?: string,
    details?: Record<string, unknown>
  ): McpError {
    const mcpError = new McpError(code, message, path, details, originalError);
    // Preserve stack trace if available
    if (originalError instanceof Error && originalError.stack) {
      mcpError.stack = `${String(mcpError.stack)}\nCaused by: ${originalError.stack}`;
    }
    return mcpError;
  }
}

/**
 * Mapping of error codes to actionable suggestions for users
 */
const ERROR_SUGGESTIONS: Readonly<Record<ErrorCode, string>> = {
  [ErrorCode.E_ACCESS_DENIED]:
    'Check that the path is within an allowed directory. Use list_allowed_directories to see available paths.',
  [ErrorCode.E_NOT_FOUND]:
    'Verify the path exists. Use list_directory to explore available files and directories.',
  [ErrorCode.E_NOT_FILE]:
    'The path points to a directory or other non-file. Use list_directory to explore its contents.',
  [ErrorCode.E_NOT_DIRECTORY]:
    'The path points to a file, not a directory. Use read_file to read file contents.',
  [ErrorCode.E_TOO_LARGE]:
    'The file exceeds the size limit. Use head or tail parameters to read partial content, or increase maxSize.',
  [ErrorCode.E_BINARY_FILE]:
    'This appears to be a binary file. Use read_media_file for images/audio, or set skipBinary=false to include.',
  [ErrorCode.E_TIMEOUT]:
    'The operation timed out. Try with a smaller scope, fewer files, or increase timeoutMs.',
  [ErrorCode.E_INVALID_PATTERN]:
    'The glob or regex pattern is invalid. Check syntax and escape special characters.',
  [ErrorCode.E_INVALID_INPUT]:
    'One or more input parameters are invalid. Check the tool documentation for correct usage.',
  [ErrorCode.E_PERMISSION_DENIED]:
    'Permission denied by the operating system. Check file permissions.',
  [ErrorCode.E_SYMLINK_NOT_ALLOWED]:
    'Symbolic links that escape allowed directories are not permitted for security reasons.',
  [ErrorCode.E_PATH_TRAVERSAL]:
    'Path traversal attempts (../) that escape allowed directories are not permitted.',
  [ErrorCode.E_UNKNOWN]:
    'An unexpected error occurred. Check the error message for details.',
} as const;

/**
 * Classify an error into an appropriate error code based on message patterns and Node.js error codes
 */
export function classifyError(error: unknown): ErrorCode {
  if (error instanceof McpError) {
    return error.code;
  }

  // Extract Node.js error code if available
  const nodeErrorCode =
    error instanceof Error && 'code' in error
      ? (error as NodeJS.ErrnoException).code
      : undefined;

  // Classify by Node.js error code first (most reliable)
  if (nodeErrorCode) {
    switch (nodeErrorCode) {
      case 'ENOENT':
        return ErrorCode.E_NOT_FOUND;
      case 'EACCES':
      case 'EPERM':
        return ErrorCode.E_PERMISSION_DENIED;
      case 'ENOTDIR':
        return ErrorCode.E_NOT_DIRECTORY;
      case 'EISDIR':
        return ErrorCode.E_NOT_FILE;
      case 'ELOOP':
        return ErrorCode.E_SYMLINK_NOT_ALLOWED;
      case 'ENAMETOOLONG':
        return ErrorCode.E_INVALID_INPUT;
      case 'ETIMEDOUT':
        return ErrorCode.E_TIMEOUT;
      case 'EMFILE':
      case 'ENFILE':
        // Too many open files - treat as timeout/resource exhaustion
        return ErrorCode.E_TIMEOUT;
      case 'EBUSY':
        return ErrorCode.E_PERMISSION_DENIED;
      case 'ENOTEMPTY':
        return ErrorCode.E_NOT_DIRECTORY;
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes('not within allowed') ||
    lowerMessage.includes('access denied') ||
    lowerMessage.includes('outside allowed')
  ) {
    return ErrorCode.E_ACCESS_DENIED;
  }
  if (
    lowerMessage.includes('enoent') ||
    lowerMessage.includes('not found') ||
    lowerMessage.includes('does not exist') ||
    lowerMessage.includes('no such file')
  ) {
    return ErrorCode.E_NOT_FOUND;
  }
  if (
    lowerMessage.includes('not a file') ||
    lowerMessage.includes('is a directory') ||
    lowerMessage.includes('eisdir')
  ) {
    return ErrorCode.E_NOT_FILE;
  }
  if (
    lowerMessage.includes('not a directory') ||
    lowerMessage.includes('enotdir')
  ) {
    return ErrorCode.E_NOT_DIRECTORY;
  }
  if (
    lowerMessage.includes('too large') ||
    lowerMessage.includes('exceeds') ||
    lowerMessage.includes('file size')
  ) {
    return ErrorCode.E_TOO_LARGE;
  }
  if (lowerMessage.includes('binary')) {
    return ErrorCode.E_BINARY_FILE;
  }
  if (lowerMessage.includes('timeout') || lowerMessage.includes('etimedout')) {
    return ErrorCode.E_TIMEOUT;
  }
  if (
    lowerMessage.includes('invalid') &&
    (lowerMessage.includes('pattern') ||
      lowerMessage.includes('regex') ||
      lowerMessage.includes('regexp') ||
      lowerMessage.includes('glob'))
  ) {
    return ErrorCode.E_INVALID_PATTERN;
  }
  if (
    lowerMessage.includes('invalid') ||
    lowerMessage.includes('cannot specify multiple') ||
    lowerMessage.includes('must be')
  ) {
    return ErrorCode.E_INVALID_INPUT;
  }
  if (
    lowerMessage.includes('eacces') ||
    lowerMessage.includes('eperm') ||
    lowerMessage.includes('permission')
  ) {
    return ErrorCode.E_PERMISSION_DENIED;
  }
  if (lowerMessage.includes('symlink') || lowerMessage.includes('eloop')) {
    return ErrorCode.E_SYMLINK_NOT_ALLOWED;
  }
  if (lowerMessage.includes('traversal')) {
    return ErrorCode.E_PATH_TRAVERSAL;
  }

  return ErrorCode.E_UNKNOWN;
}

/**
 * Create a detailed error object with suggestions
 */
export function createDetailedError(
  error: unknown,
  path?: string,
  additionalDetails?: Record<string, unknown>
): DetailedError {
  const message = error instanceof Error ? error.message : String(error);
  const code = classifyError(error);
  const suggestion = ERROR_SUGGESTIONS[code];

  const effectivePath =
    path ?? (error instanceof McpError ? error.path : undefined);
  const mergedDetails = {
    ...(error instanceof McpError ? error.details : undefined),
    ...(additionalDetails ?? undefined),
  } satisfies Record<string, unknown>;

  return {
    code,
    message,
    path: effectivePath,
    suggestion,
    details: Object.keys(mergedDetails).length > 0 ? mergedDetails : undefined,
  };
}

/**
 * Format a detailed error for display
 */
export function formatDetailedError(error: DetailedError): string {
  const lines: string[] = [`Error [${error.code}]: ${error.message}`];

  if (error.path) {
    lines.push(`Path: ${error.path}`);
  }

  if (error.suggestion) {
    lines.push(`Suggestion: ${error.suggestion}`);
  }

  return lines.join('\n');
}

/**
 * Get suggestion for an error code
 */
export function getSuggestion(code: ErrorCode): string {
  return ERROR_SUGGESTIONS[code];
}

export function createErrorResponse(
  error: unknown,
  defaultCode: ErrorCode,
  path?: string
): ErrorResponse {
  const detailed = createDetailedError(error, path);
  // Use more specific code if classified, otherwise use default
  const finalCode =
    detailed.code === ErrorCode.E_UNKNOWN ? defaultCode : detailed.code;
  detailed.code = finalCode;

  return {
    content: [{ type: 'text', text: formatDetailedError(detailed) }],
    structuredContent: {
      ok: false,
      error: {
        code: detailed.code,
        message: detailed.message,
        path: detailed.path,
        suggestion: detailed.suggestion,
      },
    },
    isError: true,
  };
}
