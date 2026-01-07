import { z } from 'zod';

const ListExcludePatternsSchema = z
  .array(
    z
      .string()
      .max(500, 'Individual exclude pattern is too long')
      .refine((val) => !val.includes('**/**/**'), {
        error: 'Pattern too deeply nested (max 2 levels of **)',
      })
  )
  .max(100, 'Too many exclude patterns (max 100)')
  .optional()
  .default([]);

export const ListDirectoryInputSchema = z.strictObject({
  path: z
    .string()
    .min(1, 'Path cannot be empty')
    .describe('Absolute or relative path to the directory to list'),
  recursive: z
    .boolean()
    .optional()
    .default(false)
    .describe('If true, list contents of subdirectories recursively'),
  excludePatterns: ListExcludePatternsSchema.describe(
    'Glob patterns to exclude (e.g., "node_modules/**")'
  ),
});
