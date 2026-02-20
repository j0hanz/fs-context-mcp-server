import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  InMemoryTaskMessageQueue,
  InMemoryTaskStore,
} from '@modelcontextprotocol/sdk/experimental/tasks/stores/in-memory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { registerCompletions } from '../completions.js';
import { formatUnknownErrorMessage } from '../lib/errors.js';
import { createInMemoryResourceStore } from '../lib/resource-store.js';
import { pkgInfo } from '../pkg-info.js';
import { registerGetHelpPrompt } from '../prompts.js';
import {
  registerInstructionResource,
  registerResultResources,
} from '../resources.js';
import { registerAllTools } from '../tools.js';
import type { IconInfo } from '../tools/shared.js';
import { withDefaultIcons } from '../tools/shared.js';
import {
  buildServerCapabilities,
  supportsTaskToolRequests,
} from './capabilities.js';
import { createLoggingState } from './logging.js';
import { RootsManager } from './roots-manager.js';
import type { ServerOptions } from './types.js';

const {
  version: SERVER_VERSION,
  description: SERVER_DESCRIPTION,
  homepage: SERVER_HOMEPAGE,
} = pkgInfo;

const rootsManagers = new WeakMap<McpServer, RootsManager>();

function getRootsManager(server: McpServer): RootsManager {
  const manager = rootsManagers.get(server);
  if (!manager) {
    throw new Error('Roots manager not initialized for server instance');
  }
  return manager;
}

async function loadServerInstructions(): Promise<string> {
  const defaultInstructions = `
Filesystem MCP Instructions
(Detailed instructions failed to load - check logs)
`;
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    return await fs.readFile(
      path.join(currentDir, '../instructions.md'),
      'utf-8'
    );
  } catch (error) {
    console.error(
      '[WARNING] Failed to load instructions.md:',
      formatUnknownErrorMessage(error)
    );
    return defaultInstructions;
  }
}

async function getLocalIconInfo(): Promise<IconInfo | undefined> {
  const name = 'logo.svg';
  const mime = 'image/svg+xml';
  const candidates = [`../assets/${name}`, `../../assets/${name}`];

  for (const candidate of candidates) {
    try {
      const iconPath = new URL(candidate, import.meta.url);
      const buffer = await fs.readFile(iconPath);
      return {
        src: `data:${mime};base64,${buffer.toString('base64')}`,
        mimeType: mime,
      };
    } catch {
      // Try next candidate.
    }
  }

  return undefined;
}

export async function createServer(
  options: ServerOptions = {}
): Promise<McpServer> {
  const resourceStore = createInMemoryResourceStore();
  const serverInstructions = await loadServerInstructions();
  const localIcon = await getLocalIconInfo();
  const taskToolSupport = supportsTaskToolRequests();

  const serverConfig: NonNullable<ConstructorParameters<typeof McpServer>[1]> =
    {
      capabilities: buildServerCapabilities({
        enablePromptListChanged: false,
        enableTaskToolRequests: taskToolSupport,
      }),
    };

  if (taskToolSupport) {
    serverConfig.taskStore = new InMemoryTaskStore();
    serverConfig.taskMessageQueue = new InMemoryTaskMessageQueue();
  }

  if (serverInstructions) {
    serverConfig.instructions = serverInstructions;
  }

  const server = new McpServer(
    withDefaultIcons(
      {
        name: 'filesystem-mcp',
        title: 'Filesystem MCP',
        version: SERVER_VERSION,
        ...(SERVER_DESCRIPTION ? { description: SERVER_DESCRIPTION } : {}),
        ...(SERVER_HOMEPAGE ? { websiteUrl: SERVER_HOMEPAGE } : {}),
      },
      localIcon
    ),
    serverConfig
  );

  const loggingState = createLoggingState('debug');
  const rootsManager = new RootsManager(options, loggingState);
  rootsManagers.set(server, rootsManager);

  server.server.setRequestHandler(SetLevelRequestSchema, (req) => {
    loggingState.minimumLevel = req.params.level;
    return {};
  });

  registerInstructionResource(server, serverInstructions, localIcon);
  registerGetHelpPrompt(server, serverInstructions, localIcon);
  registerResultResources(server, resourceStore, localIcon);
  registerCompletions(server);
  registerAllTools(server, {
    resourceStore,
    isInitialized: () => rootsManager.isInitialized(),
    ...(localIcon ? { iconInfo: localIcon } : {}),
  });

  return server;
}

export async function startServer(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  const rootsManager = getRootsManager(server);

  rootsManager.registerHandlers(server);
  await rootsManager.recomputeAllowedDirectories();
  await server.connect(transport);

  const transportAny = transport as { onclose?: (() => void) | undefined };
  const sdkOnClose = transportAny.onclose;
  transportAny.onclose = () => {
    rootsManager.destroy();
    sdkOnClose?.();
  };

  rootsManager.logMissingDirectoriesIfNeeded(server);
}
