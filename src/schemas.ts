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

const FileTypeSchema = z.enum(['file', 'directory', 'symlink', 'other']);

const ErrorSchema = z.object({
  code: z.string().describe('Error code (e.g., E_NOT_FOUND)'),
  message: z.string().describe('Human-readable error message'),
  path: z.string().optional().describe('Path that caused the error'),
  suggestion: z.string().optional().describe('Suggested action to resolve'),
});

const HeadLinesSchema = z
  .int({ error: 'head must be an integer' })
  .min(1, 'head must be at least 1')
  .max(100000, 'head cannot exceed 100,000 lines')
  .optional()
  .describe('Read only the first N lines');

const FileInfoSchema = z.object({
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

const OperationSummarySchema = z.object({
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
      'Base directory or file path to search within (leave empty for workspace root). ' +
        'Examples: "src", "lib", "tests", "src/index.ts"'
    ),
  pattern: z
    .string()
    .min(1, 'Pattern cannot be empty')
    .max(1000, 'Pattern is too long (max 1000 characters)')
    .describe(
      'Text to search for. Examples: "console.log", "import React", "className"'
    ),
  includeHidden: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include hidden files and directories'),
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
