import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { z } from 'zod';

import { getAllowedDirectories } from '../lib/path-validation.js';

export function registerSearchAndReplacePrompt(server: McpServer): void {
  server.registerPrompt(
    'search-and-replace-plan',
    {
      description:
        'Create a comprehensive plan for search and replace operations across a codebase',
      argsSchema: {
        path: completable(
          z.string().min(1).describe('Root path to search in'),
          (value) => {
            const dirs = getAllowedDirectories();
            return dirs.filter(
              (d) =>
                d.toLowerCase().includes(value.toLowerCase()) ||
                value.toLowerCase().includes(d.toLowerCase().slice(0, 10))
            );
          }
        ),
        searchPattern: z
          .string()
          .min(1)
          .describe('Pattern or text to search for (regex supported)'),
        replacement: z
          .string()
          .describe('Proposed replacement text or pattern'),
        filePattern: z
          .string()
          .optional()
          .default('**/*')
          .describe('Glob pattern for files to search (default: all files)'),
        caseSensitive: z
          .boolean()
          .optional()
          .default(false)
          .describe('Whether search should be case sensitive'),
      },
    },
    ({ path, searchPattern, replacement, filePattern, caseSensitive }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Create a search and replace plan for "${path}".

**Search Details:**
- Pattern: \`${searchPattern}\`
- Replacement: \`${replacement}\`
- File Pattern: ${filePattern}
- Case Sensitive: ${String(caseSensitive)}

Use the available filesystem tools to analyze the impact:

1. **Find All Occurrences**
   - Use \`search_content\` with pattern "${searchPattern}" and filePattern "${filePattern}"
   - Set caseSensitive=${String(caseSensitive)} and contextLines=2 for context

2. **Analyze Each Match**
   - Use \`read_file\` with line ranges to examine surrounding context for complex cases
   - Categorize matches by:
     - **Safe to Replace**: Clear matches that can be replaced automatically
     - **Review Required**: Matches that need manual verification
     - **Skip**: False positives or matches that should not be changed

3. **Impact Assessment**
   - List all affected files with match counts
   - Identify potential breaking changes:
     - API changes (function renames, parameter changes)
     - Import/export statement updates needed
     - Configuration file updates
     - Documentation updates
     - Test file updates

4. **Execution Plan**
   Provide a step-by-step plan:
   - **Phase 1**: Safe automatic replacements (list files)
   - **Phase 2**: Manual review items (list with explanations)
   - **Phase 3**: Related updates needed (imports, tests, docs)
   - **Verification Steps**: How to verify the changes work correctly

5. **Risk Analysis**
   - Potential side effects
   - Rollback strategy
   - Testing recommendations`,
          },
        },
      ],
    })
  );
}
