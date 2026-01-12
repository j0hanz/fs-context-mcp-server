import { z } from 'zod';

function isSafeGlobPattern(value: string): boolean {
  if (value.length === 0) return false;

  const absolutePattern = /^([/\\]|[A-Za-z]:[/\\]|\\\\)/u;
  if (absolutePattern.test(value)) {
    return false;
  }

  if (/[\\/]\.\.(?:[/\\]|$)/u.test(value) || value.startsWith('..')) {
    return false;
  }

  return true;
}

export const FileTypeSchema = z.enum(['file', 'directory', 'symlink', 'other']);

export const ErrorSchema = z.object({
  code: z.string().describe('Error code (e.g., E_NOT_FOUND)'),
  message: z.string().describe('Human-readable error message'),
  path: z.string().optional().describe('Path that caused the error'),
  suggestion: z.string().optional().describe('Suggested action to resolve'),
});

export const HeadLinesSchema = z
  .int({ error: 'head must be an integer' })
  .min(1, 'head must be at least 1')
  .max(100000, 'head cannot exceed 100,000 lines')
  .optional()
  .describe('Read only the first N lines');

export const FileInfoSchema = z.object({
  name: z.string(),
  path: z.string(),
  type: FileTypeSchema,
  size: z.number(),
  created: z.string().optional(),
  modified: z.string(),
  accessed: z.string().optional(),
  permissions: z.string(),
  isHidden: z.boolean().optional(),
  mimeType: z.string().optional(),
  symlinkTarget: z.string().optional(),
});

export const OperationSummarySchema = z.object({
  total: z.number(),
  succeeded: z.number(),
  failed: z.number(),
});

export const ListDirectoryInputSchema = z.strictObject({
  path: z
    .string()
    .optional()
    .describe(
      'Directory path to list (leave empty for workspace root). ' +
        'Examples: "src", "src/components", "lib/utils"'
    ),
  includeHidden: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include hidden files and directories'),
  excludePatterns: z
    .array(
      z
        .string()
        .min(1, 'Exclude pattern cannot be empty')
        .max(500, 'Exclude pattern is too long')
        .refine(isSafeGlobPattern, {
          error:
            'Exclude pattern must be relative (no absolute or ".." segments)',
        })
    )
    .max(100, 'Too many exclude patterns (max 100)')
    .optional()
    .default([])
    .describe('Glob patterns to exclude'),
  pattern: z
    .string()
    .min(1, 'Pattern cannot be empty')
    .max(1000, 'Pattern is too long (max 1000 characters)')
    .optional()
    .refine((value) => value === undefined || isSafeGlobPattern(value), {
      error: 'Pattern must be relative (no absolute or ".." segments)',
    })
    .describe('Glob pattern to include (relative, no "..")'),
  maxDepth: z
    .number()
    .int({ error: 'maxDepth must be an integer' })
    .min(0, 'maxDepth must be at least 0')
    .max(100, 'maxDepth cannot exceed 100')
    .optional()
    .default(10)
    .describe('Maximum depth when using pattern (0-100)'),
  maxEntries: z
    .number()
    .int({ error: 'maxEntries must be an integer' })
    .min(1, 'maxEntries must be at least 1')
    .max(100000, 'maxEntries cannot exceed 100,000')
    .optional()
    .default(10000)
    .describe('Maximum entries to return (1-100000)'),
  timeoutMs: z
    .number()
    .int({ error: 'timeoutMs must be an integer' })
    .min(100, 'timeoutMs must be at least 100ms')
    .max(3600000, 'timeoutMs cannot exceed 1 hour')
    .optional()
    .default(30000)
    .describe('Timeout in milliseconds'),
  sortBy: z
    .enum(['name', 'size', 'modified', 'type'])
    .optional()
    .default('name')
    .describe('Sort by: name, size, modified, type'),
  includeSymlinkTargets: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include symlink target paths (symlinks are not followed)'),
});

export const ListAllowedDirectoriesInputSchema = z
  .strictObject({})
  .describe('No input parameters.');

export const SearchFilesInputSchema = z.strictObject({
  path: z
    .string()
    .optional()
    .describe(
      'Base directory to search from (leave empty for workspace root). ' +
        'Examples: "src", "lib", "tests"'
    ),
  pattern: z
    .string()
    .min(1, 'Pattern cannot be empty')
    .max(1000, 'Pattern is too long (max 1000 characters)')
    .refine(
      (val) => {
        try {
          if (val.includes('**/**/**')) {
            return false;
          }
          return isSafeGlobPattern(val);
        } catch {
          return false;
        }
      },
      {
        error:
          'Invalid glob pattern syntax or unsafe path (absolute/.. segments not allowed)',
      }
    )
    .describe(
      'Glob pattern to match files. Examples: "**/*.ts" (all TypeScript files), "src/**/*.js" (JS files in src), "*.json" (JSON files in current dir)'
    ),
  maxResults: z
    .number()
    .int({ error: 'maxResults must be an integer' })
    .min(1, 'maxResults must be at least 1')
    .max(10000, 'maxResults cannot exceed 10,000')
    .optional()
    .default(100)
    .describe('Maximum matches to return (1-10000)'),
  includeIgnored: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Include normally ignored directories (node_modules, dist, .git, etc). ' +
        'Set to true when debugging in dependencies.'
    ),
});

export const SearchContentInputSchema = z.strictObject({
  path: z
    .string()
    .optional()
    .describe(
      'Base directory to search within (leave empty for workspace root). ' +
        'Examples: "src", "lib", "tests"'
    ),
  pattern: z
    .string()
    .min(1, 'Pattern cannot be empty')
    .max(1000, 'Pattern is too long (max 1000 characters)')
    .describe(
      'Text to search for. Examples: "console.log", "import React", "className"'
    ),
  filePattern: z
    .string()
    .min(1, 'File pattern cannot be empty')
    .max(500, 'File pattern is too long')
    .optional()
    .default('**/*')
    .refine(isSafeGlobPattern, {
      error:
        'File pattern must be relative to the base path (no absolute or ".." segments)',
    })
    .describe(
      'Glob pattern to filter files. Examples: "**/*.ts", "src/**/*.js"'
    ),
  excludePatterns: z
    .array(
      z
        .string()
        .min(1, 'Exclude pattern cannot be empty')
        .max(500, 'Exclude pattern is too long')
        .refine(isSafeGlobPattern, {
          error:
            'Exclude pattern must be relative to the base path (no absolute or ".." segments)',
        })
    )
    .max(100, 'Too many exclude patterns (max 100)')
    .optional()
    .describe('Glob patterns to exclude'),
  caseSensitive: z
    .boolean()
    .optional()
    .default(false)
    .describe('Case-sensitive search'),
  maxResults: z
    .number()
    .int({ error: 'maxResults must be an integer' })
    .min(1, 'maxResults must be at least 1')
    .max(10000, 'maxResults cannot exceed 10,000')
    .optional()
    .default(100)
    .describe('Maximum number of results'),
  maxFileSize: z
    .number()
    .int({ error: 'maxFileSize must be an integer' })
    .min(1024, 'maxFileSize must be at least 1024 bytes')
    .max(10 * 1024 * 1024, 'maxFileSize cannot exceed 10MB')
    .optional()
    .describe('Maximum file size to scan'),
  maxFilesScanned: z
    .number()
    .int({ error: 'maxFilesScanned must be an integer' })
    .min(1, 'maxFilesScanned must be at least 1')
    .max(200000, 'maxFilesScanned cannot exceed 200,000')
    .optional()
    .default(20000)
    .describe('Maximum files to scan before stopping'),
  timeoutMs: z
    .number()
    .int({ error: 'timeoutMs must be an integer' })
    .min(100, 'timeoutMs must be at least 100ms')
    .max(3600000, 'timeoutMs cannot exceed 1 hour')
    .optional()
    .default(30000)
    .describe('Timeout in milliseconds'),
  skipBinary: z
    .boolean()
    .optional()
    .default(true)
    .describe('Skip likely-binary files'),
  includeHidden: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include hidden files and directories'),
  contextLines: z
    .number()
    .int({ error: 'contextLines must be an integer' })
    .min(0, 'contextLines must be at least 0')
    .max(10, 'contextLines cannot exceed 10')
    .optional()
    .default(0)
    .describe('Lines of context before/after match (0-10)'),
  wholeWord: z
    .boolean()
    .optional()
    .default(false)
    .describe('Match whole words only'),
  isLiteral: z
    .boolean()
    .optional()
    .default(true)
    .describe('Treat pattern as literal string (escape regex chars)'),
  baseNameMatch: z
    .boolean()
    .optional()
    .default(false)
    .describe('Match file patterns without slashes against basenames'),
  caseSensitiveFileMatch: z
    .boolean()
    .optional()
    .default(true)
    .describe('Case-sensitive filename matching'),
  includeIgnored: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Include normally ignored directories (node_modules, dist, .git, etc). ' +
        'Set to true when debugging in dependencies.'
    ),
});

export const ReadFileInputSchema = z.strictObject({
  path: z
    .string()
    .min(1, 'Path cannot be empty')
    .describe(
      'Path to the file to read. ' +
        'Examples: "README.md", "src/index.ts", "package.json"'
    ),
  head: HeadLinesSchema.describe(
    'Read only the first N lines of the file (useful for previewing large files)'
  ),
});

export const ReadMultipleFilesInputSchema = z.strictObject({
  paths: z
    .array(z.string().min(1, 'Path cannot be empty'))
    .min(1, 'At least one path is required')
    .max(100, 'Cannot read more than 100 files at once')
    .describe(
      'Array of file paths to read. ' +
        'Examples: ["README.md", "package.json"], ["src/index.ts", "src/server.ts"]'
    ),
  head: HeadLinesSchema.describe('Read only the first N lines of each file'),
});

export const GetFileInfoInputSchema = z.strictObject({
  path: z
    .string()
    .min(1, 'Path cannot be empty')
    .describe(
      'Path to file or directory. ' +
        'Examples: "src", "README.md", "src/index.ts"'
    ),
});

export const GetMultipleFileInfoInputSchema = z.strictObject({
  paths: z
    .array(z.string().min(1, 'Path cannot be empty'))
    .min(1, 'At least one path is required')
    .max(100, 'Cannot get info for more than 100 files at once')
    .describe(
      'Array of file or directory paths. ' +
        'Examples: ["src", "lib"], ["package.json", "tsconfig.json"]'
    ),
});

export const ListAllowedDirectoriesOutputSchema = z.object({
  ok: z.boolean(),
  directories: z.array(z.string()).optional(),
  error: ErrorSchema.optional(),
});

export const ListDirectoryOutputSchema = z.object({
  ok: z.boolean(),
  path: z.string().optional(),
  entries: z
    .array(
      z.object({
        name: z.string().describe('Entry name (basename)'),
        relativePath: z.string().optional(),
        type: FileTypeSchema,
        size: z.number().optional(),
        modified: z.string().optional(),
      })
    )
    .optional(),
  totalEntries: z.number().optional(),
  error: ErrorSchema.optional(),
});

export const SearchFilesOutputSchema = z.object({
  ok: z.boolean(),
  results: z
    .array(
      z.object({
        path: z.string().describe('Relative path from search base'),
        size: z.number().optional(),
        modified: z.string().optional(),
      })
    )
    .optional(),
  totalMatches: z.number().optional(),
  truncated: z.boolean().optional(),
  error: ErrorSchema.optional(),
});

export const SearchContentOutputSchema = z.object({
  ok: z.boolean(),
  matches: z
    .array(
      z.object({
        file: z.string().describe('Relative path from search base'),
        line: z.number(),
        content: z.string(),
        contextBefore: z.array(z.string()).optional(),
        contextAfter: z.array(z.string()).optional(),
      })
    )
    .optional(),
  totalMatches: z.number().optional(),
  truncated: z.boolean().optional(),
  error: ErrorSchema.optional(),
});

export const ReadFileOutputSchema = z.object({
  ok: z.boolean(),
  path: z.string().optional(),
  content: z.string().optional(),
  truncated: z.boolean().optional(),
  totalLines: z.number().optional(),
  error: ErrorSchema.optional(),
});

export const ReadMultipleFilesOutputSchema = z.object({
  ok: z.boolean(),
  results: z
    .array(
      z.object({
        path: z.string(),
        content: z.string().optional(),
        truncated: z.boolean().optional(),
        error: z.string().optional(),
      })
    )
    .optional(),
  summary: OperationSummarySchema.optional(),
  error: ErrorSchema.optional(),
});

export const GetFileInfoOutputSchema = z.object({
  ok: z.boolean(),
  info: FileInfoSchema.optional(),
  error: ErrorSchema.optional(),
});

export const GetMultipleFileInfoOutputSchema = z.object({
  ok: z.boolean(),
  results: z
    .array(
      z.object({
        path: z.string(),
        info: FileInfoSchema.optional(),
        error: z.string().optional(),
      })
    )
    .optional(),
  summary: OperationSummarySchema.optional(),
  error: ErrorSchema.optional(),
});
