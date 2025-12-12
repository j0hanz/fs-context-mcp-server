import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { RootsListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Root } from '@modelcontextprotocol/sdk/types.js';

import { normalizePath } from './lib/path-utils.js';
import {
  getAllowedDirectories,
  getValidRootDirectories,
  setAllowedDirectories,
} from './lib/path-validation.js';
import { registerAllTools } from './tools/index.js';

// Get version from package.json
const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { version: string };
const SERVER_VERSION = packageJson.version;

export async function parseArgs(): Promise<string[]> {
  const args = process.argv.slice(2);

  // Allow empty args when roots protocol is available
  if (args.length === 0) {
    return [];
  }

  const validatedDirs: string[] = [];

  for (const dir of args) {
    const normalized = normalizePath(dir);

    try {
      const stats = await fs.stat(normalized);
      if (!stats.isDirectory()) {
        throw new Error(`Error: '${dir}' is not a directory`);
      }
      validatedDirs.push(normalized);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Error:')) {
        throw error;
      }
      throw new Error(`Error: Cannot access directory '${dir}'`);
    }
  }

  return validatedDirs;
}

async function updateRootsFromClient(server: McpServer): Promise<void> {
  try {
    const rootsResult = await server.server.listRoots();
    if (rootsResult.roots.length > 0) {
      const validDirs = await getValidRootDirectories(
        rootsResult.roots as Root[]
      );
      if (validDirs.length > 0) {
        const currentDirs = getAllowedDirectories();
        const mergedDirs = [...new Set([...currentDirs, ...validDirs])];
        setAllowedDirectories(mergedDirs);
        console.error('Updated allowed directories from roots:', mergedDirs);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Roots protocol not available:', message);
  }
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'filesystem-context-mcp',
    version: SERVER_VERSION,
  });

  registerAllTools(server);

  return server;
}

export async function startServer(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();

  server.server.setNotificationHandler(
    RootsListChangedNotificationSchema,
    async () => {
      console.error('Received roots/list_changed notification');
      await updateRootsFromClient(server);
    }
  );

  await server.connect(transport);
  console.error('Server connected and ready');

  // Try to update roots from client after connection
  // We don't wait for this to complete, but we log a warning if no roots are found after a short delay
  // This is a best-effort check for the user
  void updateRootsFromClient(server).then(() => {
    const dirs = getAllowedDirectories();
    if (dirs.length === 0) {
      console.error('Warning: No allowed directories configured.');
      console.error(
        'Either specify directories via CLI arguments or ensure client provides roots.'
      );
    }
  });
}
