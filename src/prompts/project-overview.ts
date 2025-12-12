import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { z } from 'zod';

import { getAllowedDirectories } from '../lib/path-validation.js';

export function registerProjectOverviewPrompt(server: McpServer): void {
  server.registerPrompt(
    'project-overview',
    {
      description:
        'Get a comprehensive overview of a project directory structure, key files, and organization patterns',
      argsSchema: {
        path: completable(
          z.string().min(1).describe('Root path of the project to analyze'),
          (value) => {
            const dirs = getAllowedDirectories();
            return dirs.filter(
              (d) =>
                d.toLowerCase().includes(value.toLowerCase()) ||
                value.toLowerCase().includes(d.toLowerCase().slice(0, 10))
            );
          }
        ),
        depth: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .default(4)
          .describe('Maximum depth to explore (default: 4)'),
      },
    },
    ({ path, depth }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please provide a comprehensive overview of the project at "${path}".

Use the available filesystem tools to:

1. **Directory Structure** - Use \`directory_tree\` with maxDepth=${String(depth)} to visualize the project layout
2. **Project Analysis** - Use \`analyze_directory\` to get statistics about file types, sizes, and recent activity
3. **Key Configuration Files** - Use \`read_multiple_files\` to read common config files if they exist:
   - package.json, tsconfig.json, pyproject.toml, Cargo.toml
   - .gitignore, README.md, LICENSE
   - Any config files in the root directory

Based on the gathered information, provide:
- **Project Type**: Identify the language(s), framework(s), and build tools
- **Directory Organization**: Explain the folder structure and conventions used
- **Key Entry Points**: Identify main files, entry points, or important modules
- **Dependencies**: Summarize key dependencies if package manifest is found
- **Notable Patterns**: Highlight any interesting architectural patterns or conventions
- **Recommendations**: Suggest any improvements to project organization if applicable`,
          },
        },
      ],
    })
  );
}
