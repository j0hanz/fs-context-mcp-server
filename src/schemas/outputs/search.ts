import { z } from 'zod';

import { ErrorSchema } from '../error-schema.js';

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
