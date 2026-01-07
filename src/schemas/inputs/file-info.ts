import { z } from 'zod';

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
