import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import { ErrorCode, toRpcError } from '../lib/errors.js';
import { computeChecksums } from '../lib/file-operations.js';
import {
  ComputeChecksumsInputSchema,
  ComputeChecksumsOutputSchema,
} from '../schemas/index.js';
import { formatBytes } from './shared/formatting.js';
import { buildToolResponse, type ToolResponse } from './tool-response.js';

type ChecksumAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha512';

interface ChecksumResult {
  path: string;
  checksum?: string;
  algorithm: ChecksumAlgorithm;
  size?: number;
  error?: string;
}

interface ComputeChecksumsResult {
  results: ChecksumResult[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
}

type ComputeChecksumsArgs = z.infer<
  z.ZodObject<typeof ComputeChecksumsInputSchema>
>;
type ComputeChecksumsStructuredResult = z.infer<
  typeof ComputeChecksumsOutputSchema
>;

function buildStructuredResult(
  result: ComputeChecksumsResult
): ComputeChecksumsStructuredResult {
  return {
    ok: true,
    results: result.results.map((r) => ({
      path: r.path,
      checksum: r.checksum,
      algorithm: r.algorithm,
      size: r.size,
      error: r.error,
    })),
    summary: result.summary,
  };
}

function buildTextResult(result: ComputeChecksumsResult): string {
  const lines: string[] = [];

  lines.push(`Checksums (${result.summary.total} files):`);
  lines.push('');

  for (const item of result.results) {
    if (item.checksum) {
      const size =
        item.size !== undefined ? ` (${formatBytes(item.size)})` : '';
      lines.push(`${item.checksum}  ${item.path}${size}`);
    } else {
      lines.push(`[Error: ${item.error ?? 'Unknown error'}]  ${item.path}`);
    }
  }

  lines.push('');
  lines.push('Summary:');
  lines.push(`  Algorithm: ${result.results[0]?.algorithm ?? 'sha256'}`);
  lines.push(`  Total: ${result.summary.total}`);
  lines.push(`  Succeeded: ${result.summary.succeeded}`);
  lines.push(`  Failed: ${result.summary.failed}`);

  return lines.join('\n');
}

async function handleComputeChecksums(
  args: ComputeChecksumsArgs
): Promise<ToolResponse<ComputeChecksumsStructuredResult>> {
  const result = await computeChecksums(args.paths, {
    algorithm: args.algorithm,
    encoding: args.encoding,
    maxFileSize: args.maxFileSize,
  });

  return buildToolResponse(
    buildTextResult(result),
    buildStructuredResult(result)
  );
}

const COMPUTE_CHECKSUMS_TOOL = {
  title: 'Compute Checksums',
  description:
    'Compute cryptographic checksums (hashes) for one or more files. ' +
    'Supports MD5, SHA-1, SHA-256, and SHA-512 algorithms. ' +
    'Uses streaming for memory efficiency with large files. ' +
    'Useful for verifying file integrity, detecting duplicates, or comparing file contents. ' +
    'Individual file errors do not fail the entire operation.',
  inputSchema: ComputeChecksumsInputSchema,
  outputSchema: ComputeChecksumsOutputSchema.shape,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
} as const;

export function registerComputeChecksumsTool(server: McpServer): void {
  server.registerTool(
    'compute_checksums',
    COMPUTE_CHECKSUMS_TOOL,
    async (args: ComputeChecksumsArgs) => {
      try {
        return await handleComputeChecksums(args);
      } catch (error: unknown) {
        throw toRpcError(error, ErrorCode.E_UNKNOWN);
      }
    }
  );
}
