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
});

export const SearchContentInputSchema = z.strictObject({
  path: z
    .string()
    .optional()
    .describe(
      'Base directory to search within (leave empty for workspace root). ' +
        'Examples: "src", "lib", "tests"'
    ),
  pattern: z
    .string()
    .min(1, 'Pattern cannot be empty')
    .max(1000, 'Pattern is too long (max 1000 characters)')
    .describe(
      'Text to search for. Examples: "TODO", "console.log", "import React"'
    ),
  filePattern: z
    .string()
    .min(1, 'File pattern cannot be empty')
    .max(500, 'File pattern is too long')
    .optional()
    .default('**/*')
    .refine(isSafeGlobPattern, {
      error:
        'File pattern must be relative to the base path (no absolute or ".." segments)',
    })
    .describe(
      'Glob pattern to filter files. Examples: "**/*.ts", "src/**/*.js"'
    ),
  includeIgnored: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Include normally ignored directories (node_modules, dist, .git, etc). ' +
        'Set to true when debugging in dependencies.'
    ),
});
