#!/usr/bin/env node
/**
 * Filesystem Context MCP Server
 *
 * A secure, read-only MCP server for filesystem scanning and searching.
 * Provides tools for listing directories, reading files, searching content,
 * and analyzing directory structures.
 *
 * Security: All operations are restricted to explicitly allowed directories,
 * with symlink escape protection and path traversal prevention.
 *
 * Usage:
 *   filesystem-context-mcp /path/to/dir1 /path/to/dir2
 *
 * Or with MCP Roots protocol (no CLI args needed).
 */
import { setAllowedDirectories } from './lib/path-validation.js';
import { createServer, parseArgs, startServer } from './server.js';

async function main(): Promise<void> {
  const allowedDirs = await parseArgs();

  if (allowedDirs.length > 0) {
    setAllowedDirectories(allowedDirs);
    console.error('Filesystem Context MCP Server starting...');
    console.error('Allowed directories (from CLI):');
    for (const dir of allowedDirs) {
      console.error(`  - ${dir}`);
    }
  } else {
    console.error('Filesystem Context MCP Server starting...');
    console.error(
      'No directories specified via CLI. Will use MCP Roots protocol if available.'
    );
  }

  const server = createServer();
  await startServer(server);
}

// Graceful shutdown handlers
process.on('SIGTERM', () => {
  console.error('Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.error('Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

// Run main and handle fatal errors
main().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
