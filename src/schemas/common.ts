import { z } from 'zod';

export const FileTypeSchema = z.enum(['file', 'directory', 'symlink', 'other']);

export const ErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
  suggestion: z.string().optional(),
});

/**
 * Schema for tree entries - uses lazy evaluation for recursive structure.
 * The base schema validates name, type, optional size, and optional children array.
 */
const BaseTreeEntrySchema = z.object({
  name: z.string(),
  type: z.enum(['file', 'directory']),
  size: z.number().optional(),
});

type TreeEntryType = z.infer<typeof BaseTreeEntrySchema> & {
  children?: TreeEntryType[];
};

export const TreeEntrySchema: z.ZodType<TreeEntryType> =
  BaseTreeEntrySchema.extend({
    children: z.lazy(() => z.array(TreeEntrySchema).optional()),
  });
