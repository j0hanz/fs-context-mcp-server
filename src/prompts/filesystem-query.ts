import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { z } from 'zod';

import { getAllowedDirectories } from '../lib/path-validation.js';

export function registerFilesystemQueryPrompt(server: McpServer): void {
  server.registerPrompt(
    'filesystem-query',
    {
      description:
        'A guided prompt for performing common filesystem exploration and analysis tasks. Provides structured guidance based on the selected operation type.',
      argsSchema: {
        path: completable(
          z.string().min(1).describe('Target path for the operation'),
          (value) => {
            const dirs = getAllowedDirectories();
            return dirs.filter(
              (d) =>
                d.toLowerCase().includes(value.toLowerCase()) ||
                value.toLowerCase().includes(d.toLowerCase().slice(0, 10))
            );
          }
        ),
        operation: z
          .enum([
            'explore',
            'find-files',
            'search-code',
            'analyze-size',
            'recent-changes',
          ])
          .describe(
            'Operation type: explore (structure), find-files (by pattern), search-code (content search), analyze-size (disk usage), recent-changes (modified files)'
          ),
        pattern: z
          .string()
          .optional()
          .describe(
            'Search pattern (glob for find-files, regex for search-code)'
          ),
        depth: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .default(5)
          .describe('Maximum depth for exploration (default: 5)'),
      },
    },
    ({ path, operation, pattern, depth }) => {
      const operationPrompts: Record<string, string> = {
        explore: `Explore the filesystem structure at "${path}".

Use these tools in sequence:
1. \`directory_tree\` with maxDepth=${String(depth)} to visualize the hierarchy
2. \`analyze_directory\` to get file statistics (types, sizes, counts)
3. \`list_directory\` with sortBy="modified" for recent activity

Provide:
- **Structure Overview**: Main directories and their purposes
- **File Distribution**: Breakdown by type and location
- **Key Files**: Important configuration or entry point files
- **Notable Findings**: Unusual patterns or large files`,

        'find-files': `Find files matching pattern "${pattern ?? '**/*'}" in "${path}".

Use these tools:
1. \`search_files\` with pattern="${pattern ?? '**/*'}" to find matching files
2. \`read_multiple_files\` to examine the most relevant matches
3. Optionally \`get_file_info\` for detailed metadata on specific files

Provide:
- **Matched Files**: List with paths and sizes
- **Pattern Analysis**: What the pattern captured
- **Content Preview**: Summary of matched file contents
- **Suggestions**: Related patterns that might be useful`,

        'search-code': `Search for code pattern "${pattern ?? ''}" in "${path}".

Use these tools:
1. \`search_content\` with pattern="${pattern ?? ''}" and contextLines=2
2. \`read_multiple_files\` to get full context for important matches
3. Group results by file and analyze patterns

Provide:
- **Match Summary**: Total matches, files affected
- **Code Context**: Key matches with surrounding code
- **Pattern Usage**: How and where the pattern appears
- **Related Code**: Suggest related patterns to explore`,

        'analyze-size': `Analyze disk usage and file sizes in "${path}".

Use these tools:
1. \`analyze_directory\` to get size statistics and largest files
2. \`directory_tree\` with includeSize=true for size visualization
3. \`search_files\` to find specific file types if needed

Provide:
- **Size Summary**: Total size, file count, directory count
- **Largest Files**: Top 10 with sizes and paths
- **Type Breakdown**: Size by file extension
- **Cleanup Suggestions**: Files that could be removed or compressed`,

        'recent-changes': `Find recently modified files in "${path}".

Use these tools:
1. \`analyze_directory\` to see recentlyModified list
2. \`list_directory\` with sortBy="modified" for detailed listing
3. \`read_multiple_files\` to examine recent changes

Provide:
- **Recent Activity**: Files modified in last 24h, week, month
- **Change Patterns**: Which areas are most active
- **File Diffs**: Summary of what changed in key files
- **Activity Insights**: Development patterns or areas of focus`,
      };

      const promptText =
        operationPrompts[operation] ??
        `Perform "${operation}" operation at "${path}".`;

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: promptText,
            },
          },
        ],
      };
    }
  );
}
