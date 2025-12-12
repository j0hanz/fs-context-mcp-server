import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { z } from 'zod';

import { getAllowedDirectories } from '../lib/path-validation.js';

export function registerAnalyzeCodebasePrompt(server: McpServer): void {
  server.registerPrompt(
    'analyze-codebase',
    {
      description:
        'Deep analysis of code patterns, architecture, and implementation details in a codebase',
      argsSchema: {
        path: completable(
          z.string().min(1).describe('Root path of the codebase to analyze'),
          (value) => {
            const dirs = getAllowedDirectories();
            return dirs.filter(
              (d) =>
                d.toLowerCase().includes(value.toLowerCase()) ||
                value.toLowerCase().includes(d.toLowerCase().slice(0, 10))
            );
          }
        ),
        focus: z
          .enum(['architecture', 'patterns', 'quality', 'security', 'all'])
          .optional()
          .default('all')
          .describe('Analysis focus area (default: all)'),
        filePattern: z
          .string()
          .optional()
          .default('**/*.{ts,js,py,java,go,rs}')
          .describe(
            'Glob pattern for files to analyze (default: common source files)'
          ),
      },
    },
    ({ path, focus, filePattern }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Perform a deep analysis of the codebase at "${path}" with focus on: ${focus}.

Use the available filesystem tools systematically:

1. **Discovery Phase**
   - Use \`directory_tree\` to understand the overall structure
   - Use \`search_files\` with pattern "${filePattern}" to find source files
   - Use \`analyze_directory\` to get file statistics and identify largest/most recent files

2. **Code Inspection Phase**
   - Use \`search_content\` to find key patterns:
     ${focus === 'architecture' || focus === 'all' ? '- Search for class/interface definitions, exports, imports' : ''}
     ${focus === 'patterns' || focus === 'all' ? '- Search for common design patterns (Factory, Singleton, Observer, etc.)' : ''}
     ${focus === 'quality' || focus === 'all' ? '- Search for TODO, FIXME, HACK comments' : ''}
     ${focus === 'security' || focus === 'all' ? '- Search for potential security concerns (eval, exec, password, secret, token)' : ''}
   - Use \`read_multiple_files\` to examine key files identified in discovery

3. **Analysis Deliverables**
   ${focus === 'architecture' || focus === 'all' ? '- **Architecture**: Module organization, dependency flow, layering patterns' : ''}
   ${focus === 'patterns' || focus === 'all' ? '- **Design Patterns**: Identified patterns, their usage, and effectiveness' : ''}
   ${focus === 'quality' || focus === 'all' ? '- **Code Quality**: Technical debt indicators, documentation coverage, consistency' : ''}
   ${focus === 'security' || focus === 'all' ? '- **Security**: Potential vulnerabilities, hardcoded secrets, input validation' : ''}
   - **Recommendations**: Prioritized list of improvements with rationale`,
          },
        },
      ],
    })
  );
}
