import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createErrorResponse, ErrorCode } from '../lib/errors.js';
import { readMultipleFiles } from '../lib/file-operations.js';
import {
  ReadMultipleFilesInputSchema,
  ReadMultipleFilesOutputSchema,
} from '../schemas/index.js';

export function registerReadMultipleFilesTool(server: McpServer): void {
  server.registerTool(
    'read_multiple_files',
    {
      title: 'Read Multiple Files',
      description:
        'Read the contents of multiple files in parallel. More efficient than reading files one by one. Individual file errors do not fail the entire operation.',
      inputSchema: ReadMultipleFilesInputSchema,
      outputSchema: ReadMultipleFilesOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ paths, encoding, maxSize, head, tail }) => {
      try {
        const results = await readMultipleFiles(paths, {
          encoding: encoding as BufferEncoding,
          maxSize,
          head,
          tail,
        });

        const succeeded = results.filter((r) => r.content !== undefined).length;
        const failed = results.filter((r) => r.error !== undefined).length;

        // Format text output
        const textParts: string[] = [];
        for (const result of results) {
          if (result.content !== undefined) {
            textParts.push(`=== ${result.path} ===\n${result.content}`);
          } else {
            textParts.push(
              `=== ${result.path} ===\n[Error: ${result.error ?? 'Unknown error'}]`
            );
          }
        }

        const structured = {
          ok: true,
          results,
          summary: {
            total: results.length,
            succeeded,
            failed,
          },
        };

        return {
          content: [{ type: 'text', text: textParts.join('\n\n') }],
          structuredContent: structured,
        };
      } catch (error) {
        return createErrorResponse(error, ErrorCode.E_UNKNOWN);
      }
    }
  );
}
