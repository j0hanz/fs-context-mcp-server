import { z } from 'zod';

import { ErrorSchema } from '../error-schema.js';
import { FileTypeSchema } from '../file-type-schema.js';

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
