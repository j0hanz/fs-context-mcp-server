import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  InMemoryTaskMessageQueue,
  InMemoryTaskStore,
} from '@modelcontextprotocol/sdk/experimental/tasks/stores/in-memory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  InitializedNotificationSchema,
  RootsListChangedNotificationSchema,
  SetLevelRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  LoggingLevel,
  LoggingMessageNotificationParams,
  Root,
} from '@modelcontextprotocol/sdk/types.js';

import { z } from 'zod';

import packageJsonRaw from '../package.json' with { type: 'json' };
import { registerCompletions } from './completions.js';
import { formatUnknownErrorMessage } from './lib/errors.js';
import {
  assertNotAborted,
  createTimedAbortSignal,
  withAbort,
} from './lib/fs-helpers.js';
import {
  getAllowedDirectories,
  getValidRootDirectories,
  isPathWithinDirectories,
  normalizePath,
  setAllowedDirectoriesResolved,
} from './lib/path-validation.js';
import { createInMemoryResourceStore } from './lib/resource-store.js';
import { registerGetHelpPrompt } from './prompts.js';
import {
  registerInstructionResource,
  registerResultResources,
} from './resources.js';
import { registerAllTools } from './tools.js';
import { type IconInfo, withDefaultIcons } from './tools/shared.js';

const PackageJsonSchema = z.object({
  version: z.string(),
  description: z.string().optional(),
  homepage: z.string().optional(),
});
const {
  version: SERVER_VERSION,
  description: SERVER_DESCRIPTION,
  homepage: SERVER_HOMEPAGE,
} = PackageJsonSchema.parse(packageJsonRaw);

function normalizeCLIDirectories(dirs: readonly string[]): string[] {
  const normalized: string[] = [];
  for (const dir of dirs) {
    const trimmed = dir.trim();
    if (trimmed.length === 0) continue;
    normalized.push(normalizePath(trimmed));
  }
  return normalized;
}

interface ServerOptions {
  allowCwd?: boolean;
  cliAllowedDirs?: string[];
}

const ROOTS_TIMEOUT_MS = 5000;
const ROOTS_DEBOUNCE_MS = 100;
const MCP_LOGGER_NAME = 'filesystem-mcp';

const LOG_LEVEL_ORDER: Record<LoggingLevel, number> = {
  debug: 0,
  info: 1,
  notice: 2,
  warning: 3,
  error: 4,
  critical: 5,
  alert: 6,
  emergency: 7,
};

function canSendMcpLogs(server: McpServer): boolean {
  const capabilities = server.server.getClientCapabilities();
  if (!capabilities || typeof capabilities !== 'object') return false;
  if (!('logging' in capabilities)) return false;
  return Boolean((capabilities as { logging?: unknown }).logging);
}

function logToMcp(
  server: McpServer | undefined,
  level: LoggingLevel,
  data: string,
  minLevel: LoggingLevel = 'debug'
): void {
  if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[minLevel]) {
    return;
  }
  if (!server || !canSendMcpLogs(server)) {
    console.error(data);
    return;
  }

  const params: LoggingMessageNotificationParams = {
    level,
    logger: MCP_LOGGER_NAME,
    data,
  };

  void server.sendLoggingMessage(params).catch((error: unknown) => {
    console.error(
      `Failed to send MCP log: ${level} │ ${data}`,
      data,
      formatUnknownErrorMessage(error)
    );
  });
}

class RootsManager {
  private rootsUpdateTimeout: ReturnType<typeof setTimeout> | undefined;
  private rootDirectories: string[] = [];
  private clientInitialized = false;
  private readonly options: ServerOptions;
  readonly loggingState: { minimumLevel: LoggingLevel };

  constructor(
    options: ServerOptions,
    loggingState?: { minimumLevel: LoggingLevel }
  ) {
    this.options = options;
    this.loggingState = loggingState ?? { minimumLevel: 'debug' };
  }

  isInitialized(): boolean {
    return this.clientInitialized;
  }

  logMissingDirectoriesIfNeeded(server: McpServer): void {
    if (getAllowedDirectories().length === 0) {
      this.logMissingDirectories(server);
    }
  }

  registerHandlers(server: McpServer): void {
    server.server.setNotificationHandler(
      InitializedNotificationSchema,
      async () => {
        this.clientInitialized = true;
        await this.updateRootsFromClient(server);
      }
    );

    server.server.setNotificationHandler(
      RootsListChangedNotificationSchema,
      () => {
        if (!this.clientInitialized) return;
        this.scheduleRootsUpdate(server);
      }
    );
  }

  private scheduleRootsUpdate(server: McpServer): void {
    if (this.rootsUpdateTimeout) {
      this.rootsUpdateTimeout.refresh();
      return;
    }

    this.rootsUpdateTimeout = setTimeout(() => {
      this.rootsUpdateTimeout = undefined;
      void this.updateRootsFromClient(server);
    }, ROOTS_DEBOUNCE_MS);
    this.rootsUpdateTimeout.unref();
  }

  async recomputeAllowedDirectories(): Promise<void> {
    const cliAllowedDirs = normalizeCLIDirectories(
      this.options.cliAllowedDirs ?? []
    );
    const allowCwd = this.options.allowCwd === true;
    const allowCwdDirs = allowCwd ? [normalizePath(process.cwd())] : [];
    const baseline = [...cliAllowedDirs, ...allowCwdDirs];
    const { signal, cleanup } = createTimedAbortSignal(
      undefined,
      ROOTS_TIMEOUT_MS
    );
    try {
      const rootsToInclude =
        baseline.length > 0
          ? await filterRootsWithinBaseline(
              this.rootDirectories,
              baseline,
              signal
            )
          : this.rootDirectories;

      const combined = [...baseline, ...rootsToInclude];
      await setAllowedDirectoriesResolved(combined, signal);
    } finally {
      cleanup();
    }
  }

  private logMissingDirectories(server?: McpServer): void {
    if (this.options.allowCwd) {
      logToMcp(
        server,
        'notice',
        'No allowed directories specified. Using the current working directory as an allowed directory.',
        this.loggingState.minimumLevel
      );
      return;
    }

    logToMcp(
      server,
      'warning',
      'No allowed directories specified. Please provide directories as command-line arguments or enable --allow-cwd to use the current working directory.',
      this.loggingState.minimumLevel
    );
  }

  private async updateRootsFromClient(server: McpServer): Promise<void> {
    try {
      const clientCapabilities = server.server.getClientCapabilities();
      if (!clientCapabilities?.roots) {
        this.rootDirectories = [];
        return;
      }

      const rootsResult = await server.server.listRoots(undefined, {
        timeout: ROOTS_TIMEOUT_MS,
      });
      const roots = extractRoots(rootsResult);
      this.rootDirectories = await resolveRootDirectories(roots);
    } catch (error) {
      logToMcp(
        server,
        'debug',
        `[DEBUG] MCP Roots protocol unavailable or failed: ${formatUnknownErrorMessage(error)}`,
        this.loggingState.minimumLevel
      );
    } finally {
      await this.recomputeAllowedDirectories();
    }
  }
}

const rootsManagers = new WeakMap<McpServer, RootsManager>();

function getRootsManager(server: McpServer): RootsManager {
  const manager = rootsManagers.get(server);
  if (!manager) {
    throw new Error('Roots manager not initialized for server instance');
  }
  return manager;
}

const RootSchema = z.strictObject({
  uri: z.string(),
  name: z.string().optional(),
});

const RootsResponseSchema = z.object({
  roots: z.array(RootSchema).optional(),
});

function extractRoots(value: unknown): Root[] {
  const parsed = RootsResponseSchema.safeParse(value);
  if (!parsed.success || !parsed.data.roots) {
    return [];
  }
  const roots: Root[] = [];
  for (const root of parsed.data.roots) {
    if (isRoot(root)) {
      roots.push(normalizeRoot(root));
    }
  }
  return roots;
}

async function resolveRootDirectories(roots: Root[]): Promise<string[]> {
  if (roots.length === 0) return [];
  const { signal, cleanup } = createTimedAbortSignal(
    undefined,
    ROOTS_TIMEOUT_MS
  );
  try {
    return await getValidRootDirectories(roots, signal);
  } finally {
    cleanup();
  }
}

function isRoot(value: unknown): value is Root {
  return (
    value !== null &&
    typeof value === 'object' &&
    'uri' in value &&
    typeof value.uri === 'string'
  );
}

function normalizeRoot(root: Root): Root {
  return root.name ? { uri: root.uri, name: root.name } : { uri: root.uri };
}

async function filterRootsWithinBaseline(
  roots: readonly string[],
  baseline: readonly string[],
  signal?: AbortSignal
): Promise<string[]> {
  const normalizedBaseline = normalizeCLIDirectories(baseline);
  const filtered: string[] = [];

  for (const root of roots) {
    const normalizedRoot = normalizePath(root);
    const isValid = await isRootWithinBaseline(
      normalizedRoot,
      normalizedBaseline,
      signal
    );
    if (isValid) filtered.push(normalizedRoot);
  }

  return filtered;
}

async function isRootWithinBaseline(
  normalizedRoot: string,
  baseline: readonly string[],
  signal?: AbortSignal
): Promise<boolean> {
  if (!isPathWithinDirectories(normalizedRoot, baseline)) {
    return false;
  }

  try {
    assertNotAborted(signal);
    const realPath = await withAbort(fs.realpath(normalizedRoot), signal);
    const normalizedReal = normalizePath(realPath);
    return isPathWithinDirectories(normalizedReal, baseline);
  } catch {
    return false;
  }
}

async function loadServerInstructions(): Promise<string> {
  const defaultInstructions = `
Filesystem MCP Instructions
(Detailed instructions failed to load - check logs)
`;
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    return await fs.readFile(path.join(currentDir, 'instructions.md'), 'utf-8');
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
  try {
    const iconPath = new URL(`../assets/${name}`, import.meta.url);
    const buffer = await fs.readFile(iconPath);
    return {
      src: `data:${mime};base64,${buffer.toString('base64')}`,
      mimeType: mime,
    };
  } catch {
    return undefined;
  }
}

export async function createServer(
  options: ServerOptions = {}
): Promise<McpServer> {
  const resourceStore = createInMemoryResourceStore();
  const serverInstructions = await loadServerInstructions();
  const localIcon = await getLocalIconInfo();
  const taskStore = new InMemoryTaskStore();
  const taskMessageQueue = new InMemoryTaskMessageQueue();

  const serverConfig: ConstructorParameters<typeof McpServer>[1] = {
    capabilities: {
      logging: {},
      resources: {},
      tools: {},
      prompts: { listChanged: true },
      completions: {},
      tasks: {
        list: {},
        cancel: {},
        requests: { tools: { call: {} } },
      },
    },
    taskStore,
    taskMessageQueue,
  };
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

  const loggingState: { minimumLevel: LoggingLevel } = {
    minimumLevel: 'debug',
  };
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

  rootsManager.logMissingDirectoriesIfNeeded(server);
}
