import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';

import { ErrorCode } from '../lib/errors.js';
import { createTimedAbortSignal } from '../lib/fs-helpers.js';
import { withToolDiagnostics } from '../lib/observability.js';
import { validateExistingPath } from '../lib/path-validation.js';
import {
  CalculateHashInputSchema,
  CalculateHashOutputSchema,
} from '../schemas.js';
import {
  buildToolErrorResponse,
  buildToolResponse,
  type ToolExtra,
  type ToolRegistrationOptions,
  type ToolResponse,
  type ToolResult,
  withDefaultIcons,
  withToolErrorHandling,
  wrapToolHandler,
} from './shared.js';

const CALCULATE_HASH_TOOL = {
  name: 'calculate_hash',
  description: 'Calculate SHA-256 hash of a file.',
  inputSchema: CalculateHashInputSchema,
  outputSchema: CalculateHashOutputSchema,
} as const;

async function handleCalculateHash(
  args: z.infer<typeof CalculateHashInputSchema>,
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof CalculateHashOutputSchema>>> {
  const validPath = await validateExistingPath(args.path, signal);
  const content = await fs.readFile(validPath, { signal });
  const hash = crypto.createHash('sha256').update(content).digest('hex');

  return buildToolResponse(hash, {
    ok: true,
    path: validPath,
    hash,
  });
}

export function registerCalculateHashTool(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  const handler = (
    args: z.infer<typeof CalculateHashInputSchema>,
    extra: ToolExtra
  ): Promise<ToolResult<z.infer<typeof CalculateHashOutputSchema>>> =>
    withToolDiagnostics(
      'calculate_hash',
      () =>
        withToolErrorHandling(
          async () => {
            const { signal, cleanup } = createTimedAbortSignal(extra.signal);
            try {
              return await handleCalculateHash(args, signal);
            } finally {
              cleanup();
            }
          },
          (error) =>
            buildToolErrorResponse(error, ErrorCode.E_UNKNOWN, args.path)
        ),
      { path: args.path }
    );

  server.registerTool(
    'calculate_hash',
    withDefaultIcons({ ...CALCULATE_HASH_TOOL }, options.iconInfo),
    wrapToolHandler(handler, {
      guard: options.isInitialized,
      progressMessage: (args) => {
        const name = path.basename(args.path);
        return `hashing: ${name}`;
      },
    })
  );
}
