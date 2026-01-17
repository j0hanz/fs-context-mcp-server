import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Stats } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs as parseNodeArgs } from 'node:util';

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
import { ErrorCode, McpError } from './lib/errors.js';
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
  RESERVED_DEVICE_NAMES,
  setAllowedDirectoriesResolved,
} from './lib/path-validation.js';
import { createInMemoryResourceStore } from './lib/resource-store.js';
import {
  registerInstructionResource,
  registerResultResources,
} from './resources.js';
import { registerAllTools } from './tools.js';
import { buildToolErrorResponse } from './tools.js';

export interface ParseArgsResult {
  allowedDirs: string[];
  allowCwd: boolean;
}

function validateCliPath(inputPath: string): void {
  if (inputPath.includes('\0')) {
    throw new Error('Path contains null bytes');
  }

  if (isWindowsDriveRelativePath(inputPath)) {
    throw new Error(
      'Windows drive-relative paths are not allowed. Use C:\\path or C:/path instead of C:path.'
    );
  }

  const reserved = getReservedCliDeviceName(inputPath);
  if (reserved) {
    throw new Error(`Reserved device name not allowed: ${reserved}`);
  }
}

function isWindowsDriveRelativePath(inputPath: string): boolean {
  if (process.platform !== 'win32') return false;
  return /^[a-zA-Z]:(?![\\/])/.test(inputPath);
}

function getReservedCliDeviceName(inputPath: string): string | undefined {
  if (process.platform !== 'win32') return undefined;
  const basename = path.basename(inputPath).split('.')[0]?.toUpperCase();
  if (!basename) return undefined;
  return RESERVED_DEVICE_NAMES.has(basename) ? basename : undefined;
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
  throw new Error(`Error: '${inputPath}' is not a directory`);
}

function isCliError(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith('Error:');
}

function normalizeDirectoryError(error: unknown, inputPath: string): Error {
  if (isCliError(error)) return error;
  return new Error(`Error: Cannot access directory '${inputPath}'`);
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

let rootsUpdateTimeout: ReturnType<typeof setTimeout> | undefined;
let rootDirectories: string[] = [];
let clientInitialized = false;
let serverOptions: ServerOptions = {};
const MCP_LOGGER_NAME = 'fs-context';

function logToMcp(
  server: McpServer | undefined,
  level: LoggingLevel,
  data: string
): void {
  if (!server) {
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
      `Failed to send MCP log (${level}):`,
      data,
      error instanceof Error ? error.message : String(error)
    );
  });
}

function setServerOptions(options: ServerOptions): void {
  serverOptions = options;
}

function logMissingDirectories(
  options: ServerOptions,
  server?: McpServer
): void {
  if (options.allowCwd) {
    logToMcp(
      server,
      'notice',
      'No directories specified. Using current working directory.'
    );
    return;
  }

  logToMcp(
    server,
    'warning',
    'No directories configured. Use --allow-cwd flag or specify directories via CLI/roots protocol. The server will not be able to access any files until directories are configured.'
  );
}

async function recomputeAllowedDirectories(): Promise<void> {
  const cliAllowedDirs = normalizeAllowedDirectories(
    serverOptions.cliAllowedDirs ?? []
  );
  const allowCwd = serverOptions.allowCwd === true;
  const allowCwdDirs = allowCwd ? [normalizePath(process.cwd())] : [];
  const baseline = [...cliAllowedDirs, ...allowCwdDirs];
  const { signal, cleanup } = createTimedAbortSignal(
    undefined,
    ROOTS_TIMEOUT_MS
  );
  try {
    const rootsToInclude =
      baseline.length > 0
        ? await filterRootsWithinBaseline(rootDirectories, baseline, signal)
        : rootDirectories;

    const combined = [...baseline, ...rootsToInclude];
    await setAllowedDirectoriesResolved(combined, signal);
  } finally {
    cleanup();
  }
}

function extractRoots(value: unknown): Root[] {
  const rawRoots =
    typeof value === 'object' && value !== null && 'roots' in value
      ? (value as { roots?: unknown }).roots
      : undefined;
  return Array.isArray(rawRoots) ? rawRoots.filter(isRoot) : [];
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

async function updateRootsFromClient(server: McpServer): Promise<void> {
  try {
    const clientCapabilities = server.server.getClientCapabilities();
    if (!clientCapabilities?.roots) {
      rootDirectories = [];
      return;
    }

    const rootsResult = await server.server.listRoots(undefined, {
      timeout: ROOTS_TIMEOUT_MS,
    });
    const roots = extractRoots(rootsResult);
    rootDirectories = await resolveRootDirectories(roots);
  } catch (error) {
    logToMcp(
      server,
      'debug',
      `[DEBUG] MCP Roots protocol unavailable or failed: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await recomputeAllowedDirectories();
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

function registerRootHandlers(server: McpServer): void {
  server.server.setNotificationHandler(
    InitializedNotificationSchema,
    async () => {
      clientInitialized = true;
      await updateRootsFromClient(server);
    }
  );

  server.server.setNotificationHandler(
    RootsListChangedNotificationSchema,
    () => {
      if (!clientInitialized) return;
      if (rootsUpdateTimeout) clearTimeout(rootsUpdateTimeout);
      rootsUpdateTimeout = setTimeout(() => {
        void updateRootsFromClient(server);
      }, ROOTS_DEBOUNCE_MS);
    }
  );
}

function logMissingDirectoriesIfNeeded(server: McpServer): void {
  if (getAllowedDirectories().length === 0) {
    logMissingDirectories(serverOptions, server);
  }
}

const PackageJsonSchema = z.object({ version: z.string() });
const { version: SERVER_VERSION } = PackageJsonSchema.parse(packageJsonRaw);

const currentDir = path.dirname(fileURLToPath(import.meta.url));
let serverInstructions = `
Filesystem Context MCP Server
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
    error instanceof Error ? error.message : String(error)
  );
}

function resolveToolErrorCode(message: string): ErrorCode {
  const explicit = extractExplicitErrorCode(message);
  if (explicit) return explicit;

  const lower = message.toLowerCase();
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return ErrorCode.E_TIMEOUT;
  }
  if (lower.includes('tool') && lower.includes('not found')) {
    return ErrorCode.E_INVALID_INPUT;
  }
  if (
    lower.includes('invalid arguments') ||
    lower.includes('input validation')
  ) {
    return ErrorCode.E_INVALID_INPUT;
  }
  if (lower.includes('disabled')) return ErrorCode.E_INVALID_INPUT;
  if (lower.includes('requires task augmentation')) {
    return ErrorCode.E_INVALID_INPUT;
  }
  return ErrorCode.E_UNKNOWN;
}

function extractExplicitErrorCode(message: string): ErrorCode | undefined {
  const match = /\bE_[A-Z_]+\b/.exec(message);
  if (!match) return undefined;

  const candidate = match[0];
  if (!candidate) return undefined;

  const codes = Object.values(ErrorCode) as string[];
  return codes.includes(candidate) ? (candidate as ErrorCode) : undefined;
}

type ToolErrorBuilder = (errorMessage: string) => {
  content: unknown[];
  structuredContent: Record<string, unknown>;
  isError: true;
};

function patchToolErrorHandling(server: McpServer): void {
  const createToolError: ToolErrorBuilder = (errorMessage: string) => {
    const code = resolveToolErrorCode(errorMessage);
    const error = new McpError(code, errorMessage);
    return buildToolErrorResponse(error, code);
  };
  Object.defineProperty(server, 'createToolError', {
    value: createToolError,
    configurable: true,
    writable: true,
  });
}

export function createServer(options: ServerOptions = {}): McpServer {
  setServerOptions(options);

  const resourceStore = createInMemoryResourceStore();

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
    },
    serverConfig
  );

  patchToolErrorHandling(server);

  registerInstructionResource(server, serverInstructions);
  registerResultResources(server, resourceStore);
  registerAllTools(server, {
    resourceStore,
    isInitialized: () => clientInitialized,
  });

  return server;
}

export async function startServer(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();

  registerRootHandlers(server);

  await recomputeAllowedDirectories();

  await server.connect(transport);

  logMissingDirectoriesIfNeeded(server);
}
