import { z } from 'zod';

import { MAX_MEDIA_FILE_SIZE } from '../lib/constants.js';
import {
  AnalyzeMaxEntriesSchema,
  BaseNameMatchSchema,
  BasicExcludePatternsSchema,
  CaseSensitiveSchema,
  ContextLinesSchema,
  EncodingSchema,
  ExcludePatternsSchema,
  HeadLinesSchema,
  IncludeHiddenSchema,
  isSafeGlobPattern,
  LineEndSchema,
  LineStartSchema,
  MaxDepthSchema,
  MaxEntriesSchema,
  MaxFileSizeSearchSchema,
  MaxFilesScannedSchema,
  MaxResultsSchema,
  ReadFileMaxSizeSchema,
  ReadMultipleFilesMaxSizeSchema,
  SkipBinarySchema,
  SortByDirectorySchema,
  SortByFileSchema,
  TailLinesSchema,
  TimeoutMsSchema,
  TopNSchema,
  TreeMaxDepthSchema,
} from './input-helpers.js';

export const ListDirectoryInputSchema = {
  path: z
    .string()
    .min(1, 'Path cannot be empty')
    .describe('Absolute or relative path to the directory to list'),
  recursive: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'If true, list contents of subdirectories recursively up to maxDepth'
    ),
  includeHidden: IncludeHiddenSchema,
  excludePatterns: z
    .array(
      z
        .string()
        .max(500, 'Individual exclude pattern is too long')
        .refine((val) => !val.includes('**/**/**'), {
          message: 'Pattern too deeply nested (max 2 levels of **)',
        })
    )
    .max(100, 'Too many exclude patterns (max 100)')
    .optional()
    .default([])
    .describe('Glob patterns to exclude (e.g., "node_modules/**")'),
  maxDepth: MaxDepthSchema.describe(
    'Maximum depth for recursive listing (higher values may impact performance)'
  ),
  maxEntries: MaxEntriesSchema,
  sortBy: SortByDirectorySchema,
  includeSymlinkTargets: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include symlink target paths for symbolic links'),
  pattern: z
    .string()
    .min(1, 'Pattern cannot be empty')
    .max(1000, 'Pattern is too long (max 1000 characters)')
    .refine(isSafeGlobPattern, {
      message:
        'Pattern must be relative (no absolute paths or ".." segments allowed)',
    })
    .optional()
    .describe('Glob pattern to include (e.g., "**/*.ts")'),
};

export const SearchFilesInputSchema = {
  path: z
    .string()
    .min(1, 'Path cannot be empty')
    .describe('Base directory to search from'),
  pattern: z
    .string()
    .min(1, 'Pattern cannot be empty')
    .max(1000, 'Pattern is too long (max 1000 characters)')
    .refine(
      (val) => {
        // Basic glob pattern validation
        try {
          // Check for potentially problematic patterns
          if (val.includes('**/**/**')) {
            return false; // Excessive nesting
          }
          return isSafeGlobPattern(val);
        } catch {
          return false;
        }
      },
      {
        message:
          'Invalid glob pattern syntax or unsafe path (absolute/.. segments not allowed)',
      }
    )
    .describe(
      'Glob pattern to match files. Examples: "**/*.ts" (all TypeScript files), "src/**/*.js" (JS files in src), "*.json" (JSON files in current dir)'
    ),
  excludePatterns: ExcludePatternsSchema.describe('Patterns to exclude'),
  maxResults: MaxResultsSchema.describe(
    'Maximum number of matches to return (prevents huge responses)'
  ),
  sortBy: SortByFileSchema,
  maxDepth: MaxDepthSchema.describe(
    'Maximum directory depth to search (lower values improve performance)'
  ),
  maxFilesScanned: MaxFilesScannedSchema,
  timeoutMs: TimeoutMsSchema.describe(
    'Timeout in milliseconds for the search operation'
  ),
  baseNameMatch: BaseNameMatchSchema.describe(
    'If true, patterns without slashes match against basename of paths. Useful for finding config files like "*.json" in nested directories'
  ),
  skipSymlinks: z
    .boolean()
    .optional()
    .default(true)
    .describe('Skip symbolic links for security and performance'),
  includeHidden: IncludeHiddenSchema.describe(
    'Include hidden files and directories (dotfiles) in the search'
  ),
};

// Base schema for reading a file with various options.
const ReadFileBaseSchema = z.object({
  path: z
    .string()
    .min(1, 'Path cannot be empty')
    .describe('Path to the file to read'),
  encoding: EncodingSchema,
  maxSize: ReadFileMaxSizeSchema,
  lineStart: LineStartSchema,
  lineEnd: LineEndSchema,
  skipBinary: z
    .boolean()
    .optional()
    .default(false)
    .describe('If true, reject binary files (use read_media_file instead)'),
  head: HeadLinesSchema.describe(
    'Read only the first N lines of the file (memory efficient for large files)'
  ),
  tail: TailLinesSchema.describe(
    'Read only the last N lines of the file (memory efficient for large files)'
  ),
});

// Schema for reading a single file.
export const ReadFileInputSchema = ReadFileBaseSchema.shape;

// Schema for reading multiple files in one request.
const ReadMultipleFilesBaseSchema = z.object({
  paths: z
    .array(z.string().min(1, 'Path cannot be empty'))
    .min(1, 'At least one path is required')
    .max(100, 'Cannot read more than 100 files at once')
    .describe('Array of file paths to read'),
  encoding: EncodingSchema,
  maxSize: ReadMultipleFilesMaxSizeSchema,
  maxTotalSize: z
    .number()
    .int('maxTotalSize must be an integer')
    .min(1, 'maxTotalSize must be at least 1 byte')
    .max(1024 * 1024 * 1024, 'maxTotalSize cannot exceed 1GB')
    .optional()
    .default(100 * 1024 * 1024)
    .describe(
      'Maximum total size in bytes for all files combined (default 100MB)'
    ),
  head: HeadLinesSchema.describe('Read only the first N lines of each file'),
  tail: TailLinesSchema.describe('Read only the last N lines of each file'),
  lineStart: LineStartSchema.describe(
    'Start line (1-indexed) for reading a range from each file'
  ),
  lineEnd: LineEndSchema.describe(
    'End line (inclusive) for reading a range from each file'
  ),
});

export const ReadMultipleFilesInputSchema = ReadMultipleFilesBaseSchema.shape;

export const GetFileInfoInputSchema = {
  path: z
    .string()
    .min(1, 'Path cannot be empty')
    .describe('Path to get information about'),
};

export const SearchContentInputSchema = {
  path: z
    .string()
    .min(1, 'Path cannot be empty')
    .describe(
      'Absolute or relative path to the base directory to search within'
    ),
  pattern: z
    .string()
    .min(1, 'Pattern cannot be empty')
    .max(1000, 'Pattern is too long (max 1000 characters)')
    .describe(
      'Regular expression pattern to search for. Examples: "TODO|FIXME" (find todos), "function\\s+\\w+" (find function declarations), "import.*from" (find imports). Use isLiteral=true for exact string matching.'
    ),
  filePattern: z
    .string()
    .min(1, 'File pattern cannot be empty')
    .max(500, 'File pattern is too long')
    .optional()
    .default('**/*')
    .refine(isSafeGlobPattern, {
      message:
        'File pattern must be relative to the base path (no absolute or ".." segments)',
    })
    .describe('Glob pattern to filter files'),
  excludePatterns: ExcludePatternsSchema.describe(
    'Glob patterns to exclude (e.g., "node_modules/**")'
  ),
  caseSensitive: CaseSensitiveSchema,
  maxResults: MaxResultsSchema.describe('Maximum number of results'),
  maxFileSize: MaxFileSizeSearchSchema,
  maxFilesScanned: MaxFilesScannedSchema,
  timeoutMs: TimeoutMsSchema.describe(
    'Timeout in milliseconds for the search operation'
  ),
  skipBinary: SkipBinarySchema,
  includeHidden: IncludeHiddenSchema.describe(
    'Include hidden files and directories (dotfiles) in the search'
  ),
  contextLines: ContextLinesSchema,
  wholeWord: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Match whole words only by adding \\b word boundaries to pattern. Useful for avoiding partial matches (e.g., searching "test" won\'t match "testing")'
    ),
  isLiteral: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Treat pattern as a literal string instead of regex. Special characters like ., *, ? will be escaped automatically. Use this when searching for exact text containing regex metacharacters.'
    ),
  baseNameMatch: BaseNameMatchSchema,
  caseSensitiveFileMatch: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'Case sensitive file pattern matching. Set to false for case-insensitive filename matching on case-insensitive filesystems'
    ),
};

export const AnalyzeDirectoryInputSchema = {
  path: z
    .string()
    .min(1, 'Path cannot be empty')
    .describe('Directory to analyze'),
  maxDepth: MaxDepthSchema.describe('Maximum depth to analyze'),
  topN: TopNSchema,
  maxEntries: AnalyzeMaxEntriesSchema.describe(
    'Maximum number of entries (files + directories) to scan'
  ),
  excludePatterns: BasicExcludePatternsSchema.describe(
    'Glob patterns to exclude (e.g., "node_modules", "*.log")'
  ),
  includeHidden: IncludeHiddenSchema,
};

export const DirectoryTreeInputSchema = {
  path: z
    .string()
    .min(1, 'Path cannot be empty')
    .describe('Directory path to build tree from'),
  maxDepth: TreeMaxDepthSchema,
  excludePatterns: BasicExcludePatternsSchema.describe(
    'Glob patterns to exclude (e.g., "node_modules", "*.log")'
  ),
  includeHidden: IncludeHiddenSchema,
  includeSize: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include file sizes in the tree'),
  maxFiles: z
    .number()
    .int('maxFiles must be an integer')
    .min(1, 'maxFiles must be at least 1')
    .max(100000, 'maxFiles cannot exceed 100,000')
    .optional()
    .describe('Maximum total number of files to include in the tree'),
};

export const ReadMediaFileInputSchema = {
  path: z
    .string()
    .min(1, 'Path cannot be empty')
    .describe('Path to the media file to read'),
  maxSize: z
    .number()
    .int('maxSize must be an integer')
    .min(1, 'maxSize must be at least 1 byte')
    .max(500 * 1024 * 1024, 'maxSize cannot exceed 500MB')
    .optional()
    .default(MAX_MEDIA_FILE_SIZE)
    .describe('Maximum file size in bytes (default 50MB)'),
};

export const DefinitionTypeSchema = z.enum([
  'function',
  'class',
  'interface',
  'type',
  'enum',
  'variable',
]);

export const SearchDefinitionsInputSchema = {
  path: z
    .string()
    .min(1, 'Path cannot be empty')
    .describe('Directory to search for definitions'),
  name: z
    .string()
    .max(100, 'Name is too long (max 100 characters)')
    .optional()
    .describe('Symbol name to find (e.g., "UserService", "handleSubmit")'),
  type: DefinitionTypeSchema.optional().describe(
    'Type of definition to find: function, class, interface, type, enum, or variable'
  ),
  caseSensitive: z
    .boolean()
    .optional()
    .default(true)
    .describe('Case sensitive name matching (default: true)'),
  maxResults: MaxResultsSchema.describe(
    'Maximum number of definitions to return'
  ),
  excludePatterns: ExcludePatternsSchema.describe(
    'Glob patterns to exclude (e.g., "node_modules/**", "**/*.test.ts")'
  ),
  includeHidden: IncludeHiddenSchema.describe(
    'Include hidden files and directories in the search'
  ),
  contextLines: ContextLinesSchema.describe(
    'Number of lines to include before and after each definition (0-10)'
  ),
};

export const GetMultipleFileInfoInputSchema = {
  paths: z
    .array(z.string().min(1, 'Path cannot be empty'))
    .min(1, 'At least one path is required')
    .max(100, 'Cannot get info for more than 100 files at once')
    .describe('Array of file or directory paths to get information about'),
  includeMimeType: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include MIME type detection for files (default: true)'),
};

export const ChecksumAlgorithmSchema = z.enum([
  'md5',
  'sha1',
  'sha256',
  'sha512',
]);
export const ChecksumEncodingSchema = z.enum(['hex', 'base64']);

export const ComputeChecksumsInputSchema = {
  paths: z
    .array(z.string().min(1, 'Path cannot be empty'))
    .min(1, 'At least one path is required')
    .max(50, 'Cannot compute checksums for more than 50 files at once')
    .describe('Array of file paths to compute checksums for'),
  algorithm: ChecksumAlgorithmSchema.optional()
    .default('sha256')
    .describe(
      'Hash algorithm to use: md5, sha1, sha256, sha512 (default: sha256)'
    ),
  encoding: ChecksumEncodingSchema.optional()
    .default('hex')
    .describe('Output encoding: hex or base64 (default: hex)'),
  maxFileSize: z
    .number()
    .int('maxFileSize must be an integer')
    .min(1, 'maxFileSize must be at least 1 byte')
    .max(1024 * 1024 * 1024, 'maxFileSize cannot exceed 1GB')
    .optional()
    .default(100 * 1024 * 1024)
    .describe(
      'Maximum file size to process in bytes (default: 100MB). Files larger than this will be skipped.'
    ),
};
