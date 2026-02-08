import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Stats } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  getSystemErrorMessage,
  getSystemErrorName,
  parseArgs as parseNodeArgs,
} from 'node:util';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  InitializedNotificationSchema,
  RootsListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  LoggingLevel,
  LoggingMessageNotificationParams,
  Root,
} from '@modelcontextprotocol/sdk/types.js';

import { z } from 'zod';

import packageJsonRaw from '../package.json' with { type: 'json' };
import { formatUnknownErrorMessage } from './lib/errors.js';
import {
  assertNotAborted,
  createTimedAbortSignal,
  withAbort,
} from './lib/fs-helpers.js';
import {
  getAllowedDirectories,
  getReservedDeviceNameForPath,
  getValidRootDirectories,
  isPathWithinDirectories,
  isWindowsDriveRelativePath,
  normalizePath,
  setAllowedDirectoriesResolved,
} from './lib/path-validation.js';
import { createInMemoryResourceStore } from './lib/resource-store.js';
import {
  registerInstructionResource,
  registerResultResources,
} from './resources.js';
import { registerAllTools } from './tools.js';
import type { IconInfo } from './tools/shared.js';

interface ParseArgsResult {
  allowedDirs: string[];
  allowCwd: boolean;
}

function validateCliPath(inputPath: string): void {
  if (inputPath.includes('\0')) {
    throw new Error('Error: Path contains null bytes');
  }

  if (isWindowsDriveRelativePath(inputPath)) {
    throw new Error(
      'Error: Windows drive-relative paths are not allowed. Use C:\\path or C:/path instead of C:path.'
    );
  }

  const reserved = getReservedDeviceNameForPath(inputPath);
  if (reserved) {
    throw new Error(
      `Error: Windows reserved device name not allowed: ${reserved}`
    );
  }
}

async function validateDirectoryPath(inputPath: string): Promise<string> {
  validateCliPath(inputPath);
  const normalized = normalizePath(inputPath);

  try {
    const stats = await fs.stat(normalized);
    assertDirectory(stats, inputPath);
    return normalized;
  } catch (error) {
    throw normalizeDirectoryError(error, inputPath);
  }
}

function assertDirectory(stats: Stats, inputPath: string): void {
  if (stats.isDirectory()) return;
  throw new Error(`Error: ${inputPath} is not a directory`);
}

function isCliError(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith('Error:');
}

function normalizeDirectoryError(error: unknown, inputPath: string): Error {
  if (isCliError(error)) return error;

  const code =
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
      ? String((error as { code?: unknown }).code)
      : undefined;

  const errno =
    error instanceof Error &&
    'errno' in error &&
    typeof (error as { errno?: unknown }).errno === 'number'
      ? (error as { errno?: unknown }).errno
      : undefined;

  if (typeof errno === 'number') {
    try {
      const name = getSystemErrorName(errno);
      const message = getSystemErrorMessage(errno);
      return new Error(
        `Error: Cannot access directory ${inputPath} (${name}: ${message})`
      );
    } catch {
      // Fall through to best-effort formatting.
    }
  }

  if (code) {
    return new Error(`Error: Cannot access directory ${inputPath} (${code})`);
  }

  return new Error(`Error: Cannot access directory ${inputPath}`);
}

async function normalizeCliDirectories(
  args: readonly string[]
): Promise<string[]> {
  return Promise.all(args.map(validateDirectoryPath));
}

function normalizeAllowedDirectories(dirs: readonly string[]): string[] {
  return dirs
    .map((dir) => dir.trim())
    .filter((dir) => dir.length > 0)
    .map(normalizePath);
}

export async function parseArgs(): Promise<ParseArgsResult> {
  const { values, positionals } = parseNodeArgs({
    args: process.argv.slice(2),
    strict: true,
    allowPositionals: true,
    options: {
      'allow-cwd': {
        type: 'boolean',
        default: false,
      },
    } as const,
  });

  const allowCwd = values['allow-cwd'];
  const allowedDirs =
    positionals.length > 0 ? await normalizeCliDirectories(positionals) : [];

  return { allowedDirs, allowCwd };
}

interface ServerOptions {
  allowCwd?: boolean;
  cliAllowedDirs?: string[];
}

const ROOTS_TIMEOUT_MS = 5000;
const ROOTS_DEBOUNCE_MS = 100;
const MCP_LOGGER_NAME = 'fs-context';

function canSendMcpLogs(server: McpServer): boolean {
  const capabilities = server.server.getClientCapabilities();
  if (!capabilities || typeof capabilities !== 'object') return false;
  if (!('logging' in capabilities)) return false;
  return Boolean((capabilities as { logging?: unknown }).logging);
}

function logToMcp(
  server: McpServer | undefined,
  level: LoggingLevel,
  data: string
): void {
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

  constructor(options: ServerOptions) {
    this.options = options;
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
        if (this.rootsUpdateTimeout) clearTimeout(this.rootsUpdateTimeout);
        this.rootsUpdateTimeout = setTimeout(() => {
          void this.updateRootsFromClient(server);
        }, ROOTS_DEBOUNCE_MS);
      }
    );
  }

  async recomputeAllowedDirectories(): Promise<void> {
    const cliAllowedDirs = normalizeAllowedDirectories(
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
        'No allowed directories specified. Using the current working directory as an allowed directory.'
      );
      return;
    }

    logToMcp(
      server,
      'warning',
      'No allowed directories specified. Please provide directories as command-line arguments or enable --allow-cwd to use the current working directory.'
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
        `[DEBUG] MCP Roots protocol unavailable or failed: ${formatUnknownErrorMessage(error)}`
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

const RootSchema = z
  .object({
    uri: z.string(),
    name: z.string().optional(),
  })
  .strict();

const RootsResponseSchema = z.object({
  roots: z.array(RootSchema).optional(),
});

function extractRoots(value: unknown): Root[] {
  const parsed = RootsResponseSchema.safeParse(value);
  if (!parsed.success || !parsed.data.roots) {
    return [];
  }
  return parsed.data.roots.filter(isRoot).map(normalizeRoot);
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
  const normalizedBaseline = normalizeAllowedDirectories(baseline);
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

const PackageJsonSchema = z.object({ version: z.string() });
const { version: SERVER_VERSION } = PackageJsonSchema.parse(packageJsonRaw);

const currentDir = path.dirname(fileURLToPath(import.meta.url));
let serverInstructions = `
FS-Context MCP Server Instructions
(Detailed instructions failed to load - check logs)
`;
try {
  serverInstructions = await fs.readFile(
    path.join(currentDir, 'instructions.md'),
    'utf-8'
  );
} catch (error) {
  console.error(
    '[WARNING] Failed to load instructions.md:',
    formatUnknownErrorMessage(error)
  );
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
  const localIcon = await getLocalIconInfo();

  const serverConfig: ConstructorParameters<typeof McpServer>[1] = {
    capabilities: {
      logging: {},
      resources: {},
      tools: {},
    },
  };
  if (serverInstructions) {
    serverConfig.instructions = serverInstructions;
  }

  const server = new McpServer(
    {
      name: 'fs-context-mcp',
      version: SERVER_VERSION,
      ...(localIcon
        ? {
            icons: [
              {
                src: localIcon.src,
                mimeType: localIcon.mimeType,
              },
            ],
          }
        : {}),
    },
    serverConfig
  );

  const rootsManager = new RootsManager(options);
  rootsManagers.set(server, rootsManager);

  registerInstructionResource(server, serverInstructions, localIcon);
  registerResultResources(server, resourceStore, localIcon);
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
