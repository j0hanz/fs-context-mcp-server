#!/usr/bin/env node
import process from 'node:process';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { DEFAULT_SEARCH_TIMEOUT_MS } from './lib/constants.js';
import { formatUnknownErrorMessage } from './lib/errors.js';
import { createTimedAbortSignal } from './lib/fs-helpers.js';
import { setAllowedDirectoriesResolved } from './lib/path-validation.js';
import {
  CliExitError,
  createServer,
  parseArgs,
  startServer,
} from './server.js';

const SHUTDOWN_TIMEOUT_MS = 5000;
let activeServer: McpServer | undefined;
let shutdownStarted = false;

async function shutdown(reason: string, exitCode = 0): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;

  process.exitCode = exitCode;

  const timer = setTimeout(() => {
    console.error(`Shutdown timed out (${reason}), forcing exit.`);
    process.exit(exitCode);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    if (activeServer) {
      await activeServer.close();
    }
  } catch (error: unknown) {
    console.error(
      `Shutdown error (${reason}):`,
      formatUnknownErrorMessage(error)
    );
  } finally {
    clearTimeout(timer);
    process.exit(exitCode);
  }
}

async function main(): Promise<void> {
  let allowedDirs: string[];
  let allowCwd: boolean;
  try {
    const parsed = await parseArgs();
    ({ allowedDirs, allowCwd } = parsed);
  } catch (error: unknown) {
    if (error instanceof CliExitError) {
      if (error.message.length > 0) {
        console.error(error.message);
      }
      process.exitCode = error.exitCode;
      return;
    }
    throw error;
  }

  if (allowedDirs.length > 0) {
    const { signal, cleanup } = createTimedAbortSignal(
      undefined,
      DEFAULT_SEARCH_TIMEOUT_MS
    );
    try {
      await setAllowedDirectoriesResolved(allowedDirs, signal);
    } finally {
      cleanup();
    }
    console.error('Allowed directories (from CLI):');
    for (const dir of allowedDirs) {
      console.error(`- ${dir}`);
    }
  } else {
    console.error(
      `No directories specified via CLI. Will use MCP Roots${allowCwd ? ' or current working directory' : ''}.`
    );
  }

  const server = await createServer({
    allowCwd,
    cliAllowedDirs: allowedDirs,
  });
  activeServer = server;
  await startServer(server);
}

process.once('SIGTERM', () => {
  void shutdown('SIGTERM', 0);
});

process.once('SIGINT', () => {
  void shutdown('SIGINT', 0);
});

process.stdin.once('end', () => {
  void shutdown('stdin end', 0);
});

process.stdin.once('close', () => {
  void shutdown('stdin close', 0);
});

process.once('unhandledRejection', (reason: unknown) => {
  console.error('Unhandled rejection:', formatUnknownErrorMessage(reason));
  void shutdown('unhandledRejection', 1);
});

process.once('uncaughtException', (error: Error) => {
  console.error('Uncaught exception:', error);
  void shutdown('uncaughtException', 1);
});

main().catch((error: unknown) => {
  console.error('Fatal error:', formatUnknownErrorMessage(error));
  void shutdown('fatal', 1);
});
