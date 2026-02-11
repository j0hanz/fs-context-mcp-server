import { z } from 'zod';

import { ErrorCode } from './config.js';

function isSafeGlobPattern(value: string): boolean {
  if (value.length === 0) return false;
  if (value.includes('**/**/**')) return false;

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

const DESC_PATH_ROOT =
  'Base directory (default: root). Absolute path required if multiple roots exist. Examples: "src", "src/components"';

const DESC_PATH_REQUIRED =
  'Absolute path to file or directory. Examples: "src/index.ts", "README.md"';

const PathSchemaBase = z
  .string()
  .max(MAX_PATH_LENGTH, `Path too long (max ${MAX_PATH_LENGTH} chars)`);

const OptionalPathSchema = PathSchemaBase.optional();

const RequiredPathSchema = PathSchemaBase.min(1, 'Path required');

const FileTypeSchema = z.enum(['file', 'directory', 'symlink', 'other']);

const TreeEntryTypeSchema = z.enum(['file', 'directory', 'symlink', 'other']);
const ListDirectorySortSchema = z.enum(['name', 'size', 'modified', 'type']);
const SearchFilesSortSchema = z.enum(['name', 'size', 'modified', 'path']);
const SearchFilesStopReasonSchema = z.enum([
  'maxResults',
  'maxFiles',
  'timeout',
]);
const ListDirectoryStopReasonSchema = z.enum(['maxEntries', 'aborted']);
const SearchContentStopReasonSchema = z.enum([
  'maxResults',
  'maxFiles',
  'timeout',
]);

interface TreeEntry {
  name: string;
  type: z.infer<typeof TreeEntryTypeSchema>;
  relativePath: string;
  children?: TreeEntry[] | undefined;
}

const TreeEntrySchema: z.ZodType<TreeEntry> = z.lazy(() =>
  z.strictObject({
    name: z.string().describe('Name'),
    type: TreeEntryTypeSchema.describe('Type'),
    relativePath: z.string().describe('Relative path'),
    children: z.array(TreeEntrySchema).optional().describe('Children'),
  })
);

const ErrorSchema = z.strictObject({
  code: z
    .enum(Object.values(ErrorCode) as [string, ...string[]])
    .describe('Error code (e.g. E_NOT_FOUND)'),
  message: z.string().describe('Human-readable message'),
  path: z.string().optional().describe('Relevant path'),
  suggestion: z.string().optional().describe('Fix suggestion'),
});

export const ToolErrorResponseSchema = z.strictObject({
  ok: z.literal(false).describe('Operation failed'),
  error: ErrorSchema.describe('Error details'),
});

const HeadLinesSchema = z
  .int({ error: 'Must be integer' })
  .min(1, 'Min: 1')
  .max(100000, 'Max: 100,000')
  .optional()
  .describe('Read first N lines');

const LineNumberSchema = z
  .number()
  .int({ error: 'Must be integer' })
  .min(1, 'Min: 1');

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
      message: "Cannot use 'head' with 'startLine'/'endLine'",
    });
  }

  if (hasEnd && !hasStart) {
    ctx.addIssue({
      code: 'custom',
      path: ['endLine'],
      message: "'endLine' requires 'startLine'",
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
      message: "'endLine' must be >= 'startLine'",
    });
  }
};

const FileInfoSchema = z.object({
  name: z.string().describe('Name'),
  path: z.string().describe('Absolute path'),
  type: FileTypeSchema.describe('Type'),
  size: z.number().describe('Size (bytes)'),
  tokenEstimate: z.number().optional().describe('Est. tokens (size/4)'),
  created: z.string().describe('Created'),
  modified: z.string().describe('Modified'),
  accessed: z.string().describe('Accessed'),
  permissions: z.string().describe('Permissions'),
  isHidden: z.boolean().describe('Hidden?'),
  mimeType: z.string().optional().describe('MIME type'),
  symlinkTarget: z.string().optional().describe('Target (symlink)'),
});

const OperationSummarySchema = z.object({
  total: z.number().describe('Total'),
  succeeded: z.number().describe('Succeeded'),
  failed: z.number().describe('Failed'),
});

const ReadRangeInputSchema = z.strictObject({
  head: HeadLinesSchema,
  startLine: LineNumberSchema.optional(),
  endLine: LineNumberSchema.optional(),
});

export const ListDirectoryInputSchema = z.strictObject({
  path: OptionalPathSchema.describe(DESC_PATH_ROOT),
  includeHidden: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include hidden items (starting with .)'),
  includeIgnored: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include ignored items (node_modules, .git, etc).'),
  maxDepth: z
    .number()
    .int({ error: 'Must be integer' })
    .min(1, 'Min: 1')
    .max(50, 'Max: 50')
    .optional()
    .describe('Max recursion depth when pattern is provided'),
  maxEntries: z
    .number()
    .int({ error: 'Must be integer' })
    .min(1, 'Min: 1')
    .max(20000, 'Max: 20,000')
    .optional()
    .describe('Maximum entries to return before truncation'),
  sortBy: ListDirectorySortSchema.optional()
    .default('name')
    .describe('Sort field (name, size, modified, type)'),
  pattern: z
    .string()
    .min(1, 'Pattern required')
    .max(1000, 'Max 1000 chars')
    .optional()
    .describe('Optional glob pattern filter (e.g. "**/*.ts")'),
  includeSymlinkTargets: z
    .boolean()
    .optional()
    .default(false)
    .describe('Resolve and include symlink targets in results'),
});

export const ListAllowedDirectoriesInputSchema = z
  .strictObject({})
  .describe('No input parameters.');

export const SearchFilesInputSchema = z.strictObject({
  path: OptionalPathSchema.describe(DESC_PATH_ROOT),
  pattern: z
    .string()
    .min(1, 'Pattern required')
    .max(1000, 'Max 1000 chars')
    .refine((val) => isSafeGlobPattern(val), {
      error: 'Invalid glob or unsafe path (absolute/.. forbidden)',
    })
    .describe('Glob pattern (e.g. "**/*.ts", "src/*.js")'),
  maxResults: z
    .number()
    .int({ error: 'Must be integer' })
    .min(1, 'Min: 1')
    .max(10000, 'Max: 10,000')
    .optional()
    .default(100)
    .describe('Max results (1-10000)'),
  includeIgnored: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include ignored items (node_modules, etc).'),
  includeHidden: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include hidden items (starting with .)'),
  sortBy: SearchFilesSortSchema.optional()
    .default('path')
    .describe('Sort by path, name, size, or modified'),
  maxDepth: z
    .number()
    .int({ error: 'Must be integer' })
    .min(0, 'Min: 0')
    .max(100, 'Max: 100')
    .optional()
    .describe('Maximum directory depth to scan'),
  maxFilesScanned: z
    .number()
    .int({ error: 'Must be integer' })
    .min(1, 'Min: 1')
    .max(200000, 'Max: 200,000')
    .optional()
    .describe('Hard cap on files scanned'),
});

export const TreeInputSchema = z.strictObject({
  path: OptionalPathSchema.describe(DESC_PATH_ROOT),
  maxDepth: z
    .number()
    .int({ error: 'Must be integer' })
    .min(0, 'Min: 0')
    .max(50, 'Max: 50')
    .optional()
    .default(5)
    .describe('Depth (0=root node only, no children). Default: 5'),
  maxEntries: z
    .number()
    .int({ error: 'Must be integer' })
    .min(1, 'Min: 1')
    .max(20000, 'Max: 20,000')
    .optional()
    .default(1000)
    .describe('Max entries (Default: 1000)'),
  includeHidden: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include hidden items (starting with .)'),
  includeIgnored: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include ignored items. Disables .gitignore.'),
});

export const SearchContentInputSchema = z.strictObject({
  path: OptionalPathSchema.describe(DESC_PATH_ROOT),
  pattern: z
    .string()
    .min(1, 'Pattern required')
    .max(1000, 'Max 1000 chars')
    .describe('Search text or regex (if isRegex=true)'),
  isRegex: z
    .boolean()
    .optional()
    .default(false)
    .describe('Treat pattern as regex'),
  caseSensitive: z
    .boolean()
    .optional()
    .default(false)
    .describe('Case-sensitive matching'),
  wholeWord: z
    .boolean()
    .optional()
    .default(false)
    .describe('Match whole words only'),
  contextLines: z
    .number()
    .int({ error: 'Must be integer' })
    .min(0, 'Min: 0')
    .max(50, 'Max: 50')
    .optional()
    .default(0)
    .describe('Include N lines of context before/after matches'),
  maxResults: z
    .number()
    .int({ error: 'Must be integer' })
    .min(0, 'Min: 0')
    .max(10000, 'Max: 10,000')
    .optional()
    .default(500)
    .describe('Maximum match rows to return'),
  maxFilesScanned: z
    .number()
    .int({ error: 'Must be integer' })
    .min(1, 'Min: 1')
    .max(200000, 'Max: 200,000')
    .optional()
    .default(20000)
    .describe('Hard cap on files scanned'),
  filePattern: z
    .string()
    .min(1, 'Pattern required')
    .max(1000, 'Max 1000 chars')
    .optional()
    .default('**/*')
    .describe('Glob for candidate files (e.g. "**/*.ts")'),
  includeHidden: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include hidden items (starting with .)'),
  includeIgnored: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include ignored items (node_modules, etc).'),
});

export const ReadFileInputSchema = ReadRangeInputSchema.extend({
  path: RequiredPathSchema.describe(DESC_PATH_REQUIRED),
  head: HeadLinesSchema.describe('Read first N lines (preview)'),
  startLine: LineNumberSchema.optional().describe(
    'Start line (1-based, inclusive)'
  ),
  endLine: LineNumberSchema.optional().describe(
    'End line (1-based, inclusive). Requires startLine.'
  ),
})
  .strict()
  .superRefine(validateReadRange);

export const ReadMultipleFilesInputSchema = ReadRangeInputSchema.extend({
  paths: z
    .array(RequiredPathSchema)
    .min(1, 'Min 1 path required')
    .max(100, 'Max 100 files')
    .describe('Files to read. e.g. ["src/index.ts"]'),
  head: HeadLinesSchema.describe('Read first N lines of each file'),
  startLine: LineNumberSchema.optional().describe(
    'Start line (1-based, inclusive) per file'
  ),
  endLine: LineNumberSchema.optional().describe(
    'End line (1-based, inclusive) per file. Requires startLine.'
  ),
})
  .strict()
  .superRefine(validateReadRange);

export const GetFileInfoInputSchema = z.strictObject({
  path: RequiredPathSchema.describe(DESC_PATH_REQUIRED),
});

export const GetMultipleFileInfoInputSchema = z.strictObject({
  paths: z
    .array(RequiredPathSchema)
    .min(1, 'Min 1 path required')
    .max(100, 'Max 100 files')
    .describe('File/directory paths. e.g. ["src", "lib"]'),
});

export const ListAllowedDirectoriesOutputSchema = z.object({
  ok: z.boolean(),
  directories: z.array(z.string()).optional().describe('Allowed directories'),
  rootsCount: z.number().optional().describe('Number of roots'),
  hasMultipleRoots: z
    .boolean()
    .optional()
    .describe('Multiple roots configured'),
  error: ErrorSchema.optional(),
});

export const ListDirectoryOutputSchema = z.object({
  ok: z.boolean(),
  path: z.string().optional(),
  entries: z
    .array(
      z.object({
        name: z.string().describe('Entry name'),
        relativePath: z.string().optional(),
        type: FileTypeSchema,
        size: z.number().optional(),
        modified: z.string().optional(),
      })
    )
    .optional(),
  totalEntries: z.number().optional(),
  truncated: z.boolean().optional(),
  entriesScanned: z.number().optional(),
  entriesVisible: z.number().optional(),
  totalFiles: z.number().optional(),
  totalDirectories: z.number().optional(),
  maxDepthReached: z.number().optional(),
  stoppedReason: ListDirectoryStopReasonSchema.optional(),
  skippedInaccessible: z.number().optional(),
  symlinksNotFollowed: z.number().optional(),
  error: ErrorSchema.optional(),
});

const SearchSummarySchema = z.object({
  totalMatches: z.number().optional().describe('Total matches found'),
  truncated: z.boolean().optional().describe('Results truncated?'),
  resourceUri: z.string().optional().describe('Full results URI'),
  error: ErrorSchema.optional(),
});

export const SearchFilesOutputSchema = SearchSummarySchema.extend({
  ok: z.boolean(),
  root: z.string().optional().describe('Search root'),
  pattern: z.string().optional().describe('Glob pattern used'),
  results: z
    .array(
      z.object({
        path: z.string().describe('Relative path'),
        size: z.number().optional(),
        modified: z.string().optional(),
      })
    )
    .optional(),
  filesScanned: z.number().optional().describe('Files scanned'),
  skippedInaccessible: z.number().optional().describe('Inaccessible files'),
  stoppedReason:
    SearchFilesStopReasonSchema.optional().describe('Why search stopped'),
});

export const SearchContentOutputSchema = SearchSummarySchema.extend({
  ok: z.boolean(),
  patternType: z
    .enum(['literal', 'regex'])
    .optional()
    .describe('Pattern interpretation'),
  caseSensitive: z.boolean().optional().describe('Case-sensitive matching'),
  matches: z
    .array(
      z.object({
        file: z.string().describe('Relative path'),
        line: z.number(),
        content: z.string(),
        matchCount: z.number(),
        contextBefore: z.array(z.string()).optional(),
        contextAfter: z.array(z.string()).optional(),
      })
    )
    .optional(),
  filesScanned: z.number().optional().describe('Files scanned'),
  filesMatched: z.number().optional().describe('Files with matches'),
  skippedTooLarge: z.number().optional().describe('Files skipped: too large'),
  skippedBinary: z.number().optional().describe('Files skipped: binary'),
  skippedInaccessible: z
    .number()
    .optional()
    .describe('Files skipped: inaccessible'),
  linesSkippedDueToRegexTimeout: z
    .number()
    .optional()
    .describe('Lines skipped due to regex timeout'),
  stoppedReason:
    SearchContentStopReasonSchema.optional().describe('Why search stopped'),
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
  content: z.string().optional().describe('Content'),
  truncated: z.boolean().optional().describe('Truncated?'),
  resourceUri: z.string().optional().describe('Full content URI'),
  totalLines: z.number().optional().describe('Total lines'),
  readMode: z.enum(['full', 'head', 'range']).optional().describe('Mode'),
  head: z.number().optional().describe('Head lines'),
  startLine: z.number().optional().describe('Start line'),
  endLine: z.number().optional().describe('End line'),
  linesRead: z.number().optional().describe('Lines read'),
  hasMoreLines: z.boolean().optional().describe('More lines?'),
});

export const ReadFileOutputSchema = ReadResultSchema.extend({
  ok: z.boolean(),
  path: z.string().optional(),
  error: ErrorSchema.optional(),
});

const ReadMultipleFileResultSchema = ReadResultSchema.extend({
  path: z.string().describe('File path'),
  truncationReason: z
    .enum(['head', 'range', 'externalized'])
    .optional()
    .describe('Why content was truncated'),
  maxTotalSize: z.number().optional().describe('Max total size budget'),
  error: z.string().optional().describe('Error message'),
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

export const CreateDirectoryInputSchema = z.strictObject({
  path: RequiredPathSchema.describe(DESC_PATH_REQUIRED),
});

export const CreateDirectoryOutputSchema = z.object({
  ok: z.boolean(),
  path: z.string().optional(),
  error: ErrorSchema.optional(),
});

export const WriteFileInputSchema = z.strictObject({
  path: RequiredPathSchema.describe(DESC_PATH_REQUIRED),
  content: z.string().describe('Content to write'),
});

export const WriteFileOutputSchema = z.object({
  ok: z.boolean(),
  path: z.string().optional(),
  bytesWritten: z.number().optional(),
  error: ErrorSchema.optional(),
});

export const EditFileInputSchema = z.strictObject({
  path: RequiredPathSchema.describe(DESC_PATH_REQUIRED),
  edits: z
    .array(
      z.object({
        oldText: z.string().describe('Exact string to replace'),
        newText: z.string().describe('Replacement string'),
      })
    )
    .min(1, 'Min 1 edit required'),
  dryRun: z
    .boolean()
    .optional()
    .default(false)
    .describe('Check only, no writes'),
});

export const EditFileOutputSchema = z.object({
  ok: z.boolean(),
  path: z.string().optional(),
  appliedEdits: z.number().optional(),
  unmatchedEdits: z
    .array(z.string())
    .optional()
    .describe('Edits that could not be applied'),
  error: ErrorSchema.optional(),
});

export const MoveFileInputSchema = z.strictObject({
  source: RequiredPathSchema.describe('Path to move'),
  destination: RequiredPathSchema.describe('New path'),
});

export const MoveFileOutputSchema = z.object({
  ok: z.boolean(),
  source: z.string().optional(),
  destination: z.string().optional(),
  error: ErrorSchema.optional(),
});

export const DeleteFileInputSchema = z.strictObject({
  path: RequiredPathSchema.describe(DESC_PATH_REQUIRED),
  recursive: z
    .boolean()
    .optional()
    .default(false)
    .describe('Delete non-empty directories'),
  ignoreIfNotExists: z
    .boolean()
    .optional()
    .default(false)
    .describe('No error if missing'),
});

export const DeleteFileOutputSchema = z.object({
  ok: z.boolean(),
  path: z.string().optional(),
  error: ErrorSchema.optional(),
});

export const CalculateHashInputSchema = z.strictObject({
  path: RequiredPathSchema.describe(DESC_PATH_REQUIRED),
});

export const CalculateHashOutputSchema = z.object({
  ok: z.boolean(),
  path: z.string().optional(),
  hash: z.string().optional().describe('SHA-256 hash'),
  isDirectory: z.boolean().optional().describe('True if path is a directory'),
  fileCount: z
    .number()
    .optional()
    .describe('Number of files hashed (directories only)'),
  error: ErrorSchema.optional(),
});

export const DiffFilesInputSchema = z.strictObject({
  original: RequiredPathSchema.describe('Path to original file'),
  modified: RequiredPathSchema.describe('Path to modified file'),
  context: z
    .number()
    .int({ error: 'Must be integer' })
    .min(0, 'Min: 0')
    .max(10000, 'Max: 10,000')
    .optional()
    .describe('Lines of context to include in the diff'),
  ignoreWhitespace: z
    .boolean()
    .optional()
    .default(false)
    .describe('Ignore leading/trailing whitespace when comparing lines'),
  stripTrailingCr: z
    .boolean()
    .optional()
    .default(false)
    .describe('Strip trailing carriage returns before diffing'),
  maxFileSize: z
    .number()
    .int({ error: 'Must be integer' })
    .min(1, 'Min: 1')
    .max(100 * 1024 * 1024, 'Max: 104,857,600 (100 MiB)')
    .optional()
    .describe('Maximum bytes per input file to diff'),
});

export const DiffFilesOutputSchema = z.object({
  ok: z.boolean(),
  diff: z.string().optional().describe('Unified diff content'),
  isIdentical: z.boolean().optional().describe('True if files are identical'),
  truncated: z.boolean().optional().describe('Diff content truncated?'),
  resourceUri: z.string().optional().describe('Full diff content URI'),
  error: ErrorSchema.optional(),
});

export const ApplyPatchInputSchema = z.strictObject({
  path: RequiredPathSchema.describe('Path to file to patch'),
  patch: z.string().describe('Unified diff content to apply'),
  fuzzy: z.boolean().optional().default(false).describe('Allow fuzzy patching'),
  fuzzFactor: z
    .number()
    .int({ error: 'Must be integer' })
    .min(0, 'Min: 0')
    .max(20, 'Max: 20')
    .optional()
    .describe('Maximum fuzzy mismatches per hunk'),
  autoConvertLineEndings: z
    .boolean()
    .optional()
    .default(true)
    .describe('Auto-convert line endings to match target file'),
  maxFileSize: z
    .number()
    .int({ error: 'Must be integer' })
    .min(1, 'Min: 1')
    .max(100 * 1024 * 1024, 'Max: 104,857,600 (100 MiB)')
    .optional()
    .describe('Maximum bytes for the target file before patching'),
  dryRun: z.boolean().optional().default(false).describe('Check only'),
});

export const ApplyPatchOutputSchema = z.object({
  ok: z.boolean(),
  path: z.string().optional(),
  applied: z.boolean().optional(),
  error: ErrorSchema.optional(),
});

export const SearchAndReplaceInputSchema = z.strictObject({
  path: OptionalPathSchema.describe(DESC_PATH_ROOT),
  filePattern: z
    .string()
    .min(1, 'Pattern required')
    .max(1000, 'Max 1000 chars')
    .refine((val) => isSafeGlobPattern(val), {
      error: 'Invalid glob or unsafe path (absolute/.. forbidden)',
    })
    .describe('Glob pattern (e.g. "**/*.ts")'),
  excludePatterns: z.array(z.string()).optional().default([]),
  searchPattern: z.string().min(1, 'Search pattern required'),
  replacement: z.string().describe('Replacement text'),
  isRegex: z.boolean().optional().default(false),
  maxFileSize: z
    .number()
    .int({ error: 'Must be integer' })
    .min(1, 'Min: 1')
    .max(100 * 1024 * 1024, 'Max: 104,857,600 (100 MiB)')
    .optional()
    .describe('Maximum bytes to read/replace per matched file'),
  dryRun: z.boolean().optional().default(false),
});

export const SearchAndReplaceOutputSchema = z.object({
  ok: z.boolean(),
  matches: z.number().optional().describe('Total matches found'),
  filesChanged: z.number().optional().describe('Files modified'),
  processedFiles: z.number().optional().describe('Files processed'),
  failedFiles: z.number().optional().describe('Files skipped due to errors'),
  failures: z
    .array(
      z.object({
        path: z.string().describe('File path'),
        error: z.string().describe('Error message'),
      })
    )
    .optional()
    .describe('Sample of per-file errors'),
  changedFiles: z
    .array(
      z.object({
        path: z.string().describe('File path'),
        matches: z.number().describe('Matches in file'),
      })
    )
    .optional()
    .describe('Sample of changed files'),
  changedFilesTruncated: z
    .boolean()
    .optional()
    .describe('Changed file list truncated'),
  dryRun: z.boolean().optional(),
  error: ErrorSchema.optional(),
});
