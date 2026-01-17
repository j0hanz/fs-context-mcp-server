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

const MAX_PATH_LENGTH = 4096;
const OptionalPathSchema = z
  .string()
  .max(MAX_PATH_LENGTH, `Path is too long (max ${MAX_PATH_LENGTH} characters)`)
  .optional();

const RequiredPathSchema = z
  .string()
  .min(1, 'Path cannot be empty')
  .max(MAX_PATH_LENGTH, `Path is too long (max ${MAX_PATH_LENGTH} characters)`);

const FileTypeSchema = z.enum(['file', 'directory', 'symlink', 'other']);

const TreeEntryTypeSchema = z.enum(['file', 'directory', 'symlink', 'other']);

interface TreeEntry {
  name: string;
  type: z.infer<typeof TreeEntryTypeSchema>;
  relativePath: string;
  children?: TreeEntry[] | undefined;
}

const TreeEntrySchema: z.ZodType<TreeEntry> = z.lazy(() =>
  z.object({
    name: z.string(),
    type: TreeEntryTypeSchema,
    relativePath: z.string(),
    children: z.array(TreeEntrySchema).optional(),
  })
);

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

const LineNumberSchema = z
  .number()
  .int({ error: 'line numbers must be integers' })
  .min(1, 'line numbers must be at least 1');

interface ReadRangeValue {
  head?: number | undefined;
  startLine?: number | undefined;
  endLine?: number | undefined;
}

const validateReadRange = (
  value: ReadRangeValue,
  ctx: z.RefinementCtx
): void => {
  const hasHead = value.head !== undefined;
  const hasStart = value.startLine !== undefined;
  const hasEnd = value.endLine !== undefined;

  if (hasHead && (hasStart || hasEnd)) {
    ctx.addIssue({
      code: 'custom',
      path: ['head'],
      message: 'head cannot be used together with startLine/endLine',
    });
  }

  if (hasEnd && !hasStart) {
    ctx.addIssue({
      code: 'custom',
      path: ['endLine'],
      message: 'endLine requires startLine',
    });
  }

  if (
    value.startLine !== undefined &&
    value.endLine !== undefined &&
    value.endLine < value.startLine
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['endLine'],
      message: 'endLine must be greater than or equal to startLine',
    });
  }
};

const FileInfoSchema = z.object({
  name: z.string(),
  path: z.string(),
  type: FileTypeSchema,
  size: z.number(),
  tokenEstimate: z
    .number()
    .optional()
    .describe('Approximate token count estimate (rule of thumb: ceil(size/4))'),
  created: z.string(),
  modified: z.string(),
  accessed: z.string(),
  permissions: z.string(),
  isHidden: z.boolean(),
  mimeType: z.string().optional(),
  symlinkTarget: z.string().optional(),
});

const OperationSummarySchema = z.object({
  total: z.number(),
  succeeded: z.number(),
  failed: z.number(),
});

const ReadRangeInputSchema = z.strictObject({
  head: HeadLinesSchema,
  startLine: LineNumberSchema.optional(),
  endLine: LineNumberSchema.optional(),
});

export const ListDirectoryInputSchema = z.strictObject({
  path: OptionalPathSchema.describe(
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
  path: OptionalPathSchema.describe(
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

export const TreeInputSchema = z.strictObject({
  path: OptionalPathSchema.describe(
    'Base directory to render as a tree (leave empty for workspace root). Examples: "src", "lib"'
  ),
  maxDepth: z
    .number()
    .int({ error: 'maxDepth must be an integer' })
    .min(0, 'maxDepth must be at least 0')
    .max(50, 'maxDepth cannot exceed 50')
    .optional()
    .default(5)
    .describe('Maximum depth to recurse (0 = just the root)'),
  maxEntries: z
    .number()
    .int({ error: 'maxEntries must be an integer' })
    .min(1, 'maxEntries must be at least 1')
    .max(20000, 'maxEntries cannot exceed 20,000')
    .optional()
    .default(1000)
    .describe('Maximum number of entries to return before truncating'),
  includeHidden: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include hidden files and directories'),
  includeIgnored: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Include normally ignored directories (node_modules, dist, .git, etc). ' +
        'When true, also disables root .gitignore filtering.'
    ),
});

export const SearchContentInputSchema = z.strictObject({
  path: OptionalPathSchema.describe(
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

export const ReadFileInputSchema = ReadRangeInputSchema.extend({
  path: RequiredPathSchema.describe(
    'Path to the file to read. ' +
      'Examples: "README.md", "src/index.ts", "package.json"'
  ),
  head: HeadLinesSchema.describe(
    'Read only the first N lines of the file (useful for previewing large files)'
  ),
  startLine: LineNumberSchema.optional().describe(
    '1-based line number to start reading from (inclusive). Useful for reading context around a match.'
  ),
  endLine: LineNumberSchema.optional().describe(
    '1-based line number to stop reading at (inclusive). Requires startLine.'
  ),
}).superRefine(validateReadRange);

export const ReadMultipleFilesInputSchema = ReadRangeInputSchema.extend({
  paths: z
    .array(RequiredPathSchema)
    .min(1, 'At least one path is required')
    .max(100, 'Cannot read more than 100 files at once')
    .describe(
      'Array of file paths to read. ' +
        'Examples: ["README.md", "package.json"], ["src/index.ts", "src/server.ts"]'
    ),
  head: HeadLinesSchema.describe('Read only the first N lines of each file'),
  startLine: LineNumberSchema.optional().describe(
    '1-based line number to start reading from (inclusive), applied to each file.'
  ),
  endLine: LineNumberSchema.optional().describe(
    '1-based line number to stop reading at (inclusive), applied to each file. Requires startLine.'
  ),
}).superRefine(validateReadRange);

export const GetFileInfoInputSchema = z.strictObject({
  path: RequiredPathSchema.describe(
    'Path to file or directory. ' +
      'Examples: "src", "README.md", "src/index.ts"'
  ),
});

export const GetMultipleFileInfoInputSchema = z.strictObject({
  paths: z
    .array(RequiredPathSchema)
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

const SearchSummarySchema = z.object({
  totalMatches: z.number().optional(),
  truncated: z.boolean().optional(),
  resourceUri: z.string().optional(),
  error: ErrorSchema.optional(),
});

export const SearchFilesOutputSchema = SearchSummarySchema.extend({
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
});

export const SearchContentOutputSchema = SearchSummarySchema.extend({
  ok: z.boolean(),
  matches: z
    .array(
      z.object({
        file: z.string().describe('Relative path from search base'),
        line: z.number(),
        content: z.string(),
        matchCount: z.number(),
        contextBefore: z.array(z.string()).optional(),
        contextAfter: z.array(z.string()).optional(),
      })
    )
    .optional(),
});

export const TreeOutputSchema = z.object({
  ok: z.boolean(),
  root: z.string().optional(),
  tree: TreeEntrySchema.optional(),
  ascii: z.string().optional(),
  truncated: z.boolean().optional(),
  totalEntries: z.number().optional(),
  error: ErrorSchema.optional(),
});

const ReadResultSchema = z.object({
  content: z.string().optional(),
  truncated: z.boolean().optional(),
  resourceUri: z.string().optional(),
  totalLines: z.number().optional(),
  readMode: z.enum(['full', 'head', 'range']).optional(),
  head: z.number().optional(),
  startLine: z.number().optional(),
  endLine: z.number().optional(),
  linesRead: z.number().optional(),
  hasMoreLines: z.boolean().optional(),
});

export const ReadFileOutputSchema = ReadResultSchema.extend({
  ok: z.boolean(),
  path: z.string().optional(),
  error: ErrorSchema.optional(),
});

const ReadMultipleFileResultSchema = ReadResultSchema.extend({
  path: z.string(),
  error: z.string().optional(),
});

export const ReadMultipleFilesOutputSchema = z.object({
  ok: z.boolean(),
  results: z.array(ReadMultipleFileResultSchema).optional(),
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
