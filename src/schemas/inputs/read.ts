import { z } from 'zod';

import { HeadLinesSchema } from '../line-range-schemas.js';

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
