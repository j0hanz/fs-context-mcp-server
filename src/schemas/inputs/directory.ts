import { z } from 'zod';

export const ListDirectoryInputSchema = z.strictObject({
  path: z
    .string()
    .optional()
    .describe(
      'Directory path to list (leave empty for workspace root). ' +
        'Examples: "src", "src/components", "lib/utils"'
    ),
});
