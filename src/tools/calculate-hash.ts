import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createReadStream } from 'node:fs';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import { ErrorCode } from '../lib/errors.js';
import { globEntries } from '../lib/file-operations/glob-engine.js';
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
  title: 'Calculate Hash',
  description: 'Calculate SHA-256 hash of a file or directory.',
  inputSchema: CalculateHashInputSchema,
  outputSchema: CalculateHashOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

async function hashFile(
  filePath: string,
  signal?: AbortSignal
): Promise<string> {
  const hashOp = crypto.createHash('sha256');
  const stream = createReadStream(filePath, { signal });

  for await (const chunk of stream) {
    hashOp.update(chunk as Buffer | string);
  }

  return hashOp.digest('hex');
}

async function hashDirectory(
  dirPath: string,
  signal?: AbortSignal
): Promise<{ hash: string; fileCount: number }> {
  // Enumerate all files in directory (respects .gitignore by default)
  const entries: { path: string; hash: string }[] = [];

  for await (const entry of globEntries({
    cwd: dirPath,
    pattern: '**/*',
    excludePatterns: [],
    includeHidden: false,
    baseNameMatch: false,
    caseSensitiveMatch: true,
    followSymbolicLinks: false,
    onlyFiles: true,
    stats: false,
    suppressErrors: true,
  })) {
    if (signal?.aborted) {
      throw new Error('Operation aborted');
    }

    // entry.path is already absolute, no need to join
    const fileHash = await hashFile(entry.path, signal);
    // Store relative path for deterministic sorting
    const relativePath = path.relative(dirPath, entry.path);
    entries.push({ path: relativePath, hash: fileHash });
  }

  // Sort by path for deterministic ordering
  entries.sort((a, b) => a.path.localeCompare(b.path));

  // Create composite hash: hash(path1 + hash1 + path2 + hash2 + ...)
  const compositeHasher = crypto.createHash('sha256');
  for (const { path: filePath, hash: fileHash } of entries) {
    compositeHasher.update(filePath);
    compositeHasher.update(fileHash);
  }

  return {
    hash: compositeHasher.digest('hex'),
    fileCount: entries.length,
  };
}

async function handleCalculateHash(
  args: z.infer<typeof CalculateHashInputSchema>,
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof CalculateHashOutputSchema>>> {
  const validPath = await validateExistingPath(args.path, signal);

  // Check if path is a directory or file
  const stats = await fs.stat(validPath);

  if (stats.isDirectory()) {
    // Hash directory: composite hash of all files
    const { hash, fileCount } = await hashDirectory(validPath, signal);

    return buildToolResponse(`${hash} (${fileCount} files)`, {
      ok: true,
      path: validPath,
      hash,
      isDirectory: true,
      fileCount,
    });
  } else {
    // Hash single file
    const hash = await hashFile(validPath, signal);

    return buildToolResponse(hash, {
      ok: true,
      path: validPath,
      hash,
      isDirectory: false,
    });
  }
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
        return `⩩ calculate_hash: ${name}`;
      },
    })
  );
}
