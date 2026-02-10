import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import { ErrorCode } from '../lib/errors.js';
import { globEntries } from '../lib/file-operations/glob-engine.js';
import {
  assertNotAborted,
  createTimedAbortSignal,
  withAbort,
} from '../lib/fs-helpers.js';
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

const WINDOWS_PATH_SEPARATOR = /\\/gu;

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
  assertNotAborted(signal);
  const hashOp = createHash('sha256');
  const stream = createReadStream(filePath, { signal });

  for await (const chunk of stream) {
    hashOp.update(chunk as Buffer | string);
    assertNotAborted(signal);
  }

  assertNotAborted(signal);
  return hashOp.digest('hex');
}

function toStableRelativePath(root: string, entryPath: string): string {
  const relativePath = path.relative(root, entryPath);
  return relativePath.includes(path.win32.sep)
    ? relativePath.replace(WINDOWS_PATH_SEPARATOR, '/')
    : relativePath;
}

function comparePaths(left: { path: string }, right: { path: string }): number {
  if (left.path < right.path) return -1;
  if (left.path > right.path) return 1;
  return 0;
}

function updateCompositeHash(
  hasher: ReturnType<typeof createHash>,
  relativePath: string,
  fileHash: string
): void {
  const relativePathBytes = Buffer.from(relativePath, 'utf8');
  const pathLengthBytes = Buffer.alloc(4);
  pathLengthBytes.writeUInt32BE(relativePathBytes.length, 0);

  hasher.update(pathLengthBytes);
  hasher.update(relativePathBytes);
  hasher.update(Buffer.from(fileHash, 'hex'));
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
    assertNotAborted(signal);

    // entry.path is already absolute, no need to join
    const fileHash = await hashFile(entry.path, signal);
    // Use posix separators so hashes are stable across OS path separators.
    const relativePath = toStableRelativePath(dirPath, entry.path);
    entries.push({ path: relativePath, hash: fileHash });
  }

  assertNotAborted(signal);
  // Sort by path with byte-wise semantics for deterministic ordering.
  entries.sort(comparePaths);

  // Create composite hash using length-delimited paths and binary digests.
  const compositeHasher = createHash('sha256');
  for (const { path: filePath, hash: fileHash } of entries) {
    updateCompositeHash(compositeHasher, filePath, fileHash);
    assertNotAborted(signal);
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
  const stats = await withAbort(fs.stat(validPath), signal);

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
        return `⌗ calculate_hash: ${name}`;
      },
    })
  );
}
