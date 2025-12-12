import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { z } from 'zod';

import { getAllowedDirectories } from '../lib/path-validation.js';

export function registerFindDuplicatesPrompt(server: McpServer): void {
  server.registerPrompt(
    'find-duplicates',
    {
      description:
        'Find duplicate or similar code patterns, files, and potential refactoring opportunities',
      argsSchema: {
        path: completable(
          z.string().min(1).describe('Root path to search for duplicates'),
          (value) => {
            const dirs = getAllowedDirectories();
            return dirs.filter(
              (d) =>
                d.toLowerCase().includes(value.toLowerCase()) ||
                value.toLowerCase().includes(d.toLowerCase().slice(0, 10))
            );
          }
        ),
        pattern: z
          .string()
          .optional()
          .default('**/*.{ts,js,tsx,jsx,py,java}')
          .describe('Glob pattern for files to check (default: source files)'),
        searchTerm: z
          .string()
          .optional()
          .describe(
            'Optional specific pattern or function name to find duplicates of'
          ),
      },
    },
    ({ path, pattern, searchTerm }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Find duplicate code and refactoring opportunities in "${path}".

Use the available filesystem tools:

1. **File Discovery**
   - Use \`search_files\` with pattern "${pattern}" to find all relevant files
   - Use \`analyze_directory\` to identify files of similar sizes (potential duplicates)

2. **Content Analysis**
   ${
     searchTerm
       ? `- Use \`search_content\` to find all occurrences of "${searchTerm}"`
       : `- Use \`search_content\` to find common duplicate patterns:
     - Similar function signatures
     - Repeated import statements
     - Common utility patterns (error handling, logging, validation)
     - Copied configuration blocks`
   }

3. **Detailed Inspection**
   - Use \`read_multiple_files\` to compare files with similar sizes or names
   - Look for:
     - Copy-pasted code blocks
     - Functions with similar logic but different names
     - Repeated patterns that could be abstracted
     - Similar error handling or validation logic

4. **Report Findings**
   - **Exact Duplicates**: Files or code blocks that are identical
   - **Near Duplicates**: Similar code with minor variations
   - **Pattern Opportunities**: Repeated patterns that could be abstracted into utilities
   - **Refactoring Suggestions**: Specific recommendations with:
     - Which files are affected
     - Proposed abstraction or consolidation
     - Estimated complexity reduction
     - Potential risks of refactoring`,
          },
        },
      ],
    })
  );
}
