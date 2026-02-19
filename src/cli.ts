import * as fs from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { getSystemErrorMessage, getSystemErrorName } from 'node:util';

import { z } from 'zod';

import { Command, CommanderError, InvalidArgumentError } from 'commander';

import packageJsonRaw from '../package.json' with { type: 'json' };
import {
  getReservedDeviceNameForPath,
  isWindowsDriveRelativePath,
  normalizePath,
} from './lib/path-validation.js';

const PackageJsonSchema = z.object({ version: z.string() });
const { version: SERVER_VERSION } = PackageJsonSchema.parse(packageJsonRaw);
const IS_WINDOWS = process.platform === 'win32';

export class CliExitError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number) {
    super(message);
    this.name = 'CliExitError';
    this.exitCode = exitCode;
  }
}

function validateCliPath(inputPath: string): void {
  if (inputPath.includes('\0')) {
    throw new InvalidArgumentError('Path contains null bytes.');
  }

  if (isWindowsDriveRelativePath(inputPath)) {
    throw new InvalidArgumentError(
      'Windows drive-relative paths are not allowed. Use C:\\path or C:/path instead of C:path.'
    );
  }

  const reserved = getReservedDeviceNameForPath(inputPath);
  if (reserved) {
    throw new InvalidArgumentError(
      `Windows reserved device name not allowed: ${reserved}.`
    );
  }
}

function getNodeErrorProperty(
  error: unknown,
  key: 'code' | 'errno'
): string | number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const value = (error as Record<string, unknown>)[key];
  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  return undefined;
}

function getNodeErrorCode(error: unknown): string | undefined {
  const code = getNodeErrorProperty(error, 'code');
  return typeof code === 'string' ? code : undefined;
}

function getNodeErrorErrno(error: unknown): number | undefined {
  const errno = getNodeErrorProperty(error, 'errno');
  return typeof errno === 'number' ? errno : undefined;
}

function normalizeDirectoryError(error: unknown, inputPath: string): Error {
  const code = getNodeErrorCode(error);
  const errno = getNodeErrorErrno(error);
  if (error instanceof Error && code === undefined && errno === undefined) {
    return error;
  }

  if (typeof errno === 'number') {
    try {
      const name = getSystemErrorName(errno);
      const message = getSystemErrorMessage(errno);
      return new Error(
        `Cannot access directory ${inputPath} (${name}: ${message})`
      );
    } catch {
      // Fall through to best-effort formatting.
    }
  }

  if (code) {
    return new Error(`Cannot access directory ${inputPath} (${code})`);
  }

  return new Error(`Cannot access directory ${inputPath}`);
}

function assertDirectory(stats: Stats, inputPath: string): void {
  if (stats.isDirectory()) return;
  throw new Error(`${inputPath} is not a directory`);
}

async function validateDirectoryPath(inputPath: string): Promise<string> {
  const normalized = normalizePath(inputPath);

  try {
    const stats = await fs.stat(normalized);
    assertDirectory(stats, inputPath);
    return normalized;
  } catch (error) {
    throw normalizeDirectoryError(error, inputPath);
  }
}

async function normalizeCliDirectories(
  args: readonly string[]
): Promise<string[]> {
  const validations: Promise<string>[] = [];
  for (const arg of args) {
    validations.push(validateDirectoryPath(arg));
  }
  return Promise.all(validations);
}

function parseAllowedDirArgument(value: string, previous: unknown): string[] {
  validateCliPath(value);

  const values: string[] = [];
  if (Array.isArray(previous)) {
    for (const item of previous) {
      if (typeof item === 'string') {
        values.push(item);
      }
    }
  }

  return [...values, value];
}

function getParsedAllowedDirs(cli: Command): string[] {
  const [allowedDirs] = cli.processedArgs as unknown[];
  if (!Array.isArray(allowedDirs)) return [];
  const parsed: string[] = [];
  for (const candidate of allowedDirs) {
    if (typeof candidate === 'string') {
      parsed.push(candidate);
    }
  }
  return parsed;
}

function createCliProgram(output: string[]): Command {
  const cli = new Command();
  cli
    .name('filesystem-mcp')
    .usage('[options] [allowedDirs...]')
    .description(
      'MCP filesystem server. Positional directories define allowed access roots.'
    )
    .argument(
      '[allowedDirs...]',
      'Directories the MCP server can access on disk',
      parseAllowedDirArgument
    )
    .option(
      '--allow_cwd, --allow-cwd',
      'Allow the current working directory as an additional root'
    )
    .helpOption('-h, --help', 'Display command help')
    .version(SERVER_VERSION, '-v, --version', 'Display server version')
    .addHelpText(
      'after',
      `
Examples:
  $ filesystem-mcp /path/to/allowed/dir
  $ filesystem-mcp --allow-cwd
  $ filesystem-mcp /project/src /project/tests --allow-cwd
`
    );

  cli.allowUnknownOption(false);
  cli.allowExcessArguments(false);
  cli.showHelpAfterError('(run with --help for usage)');
  cli.showSuggestionAfterError(true);
  cli.exitOverride();
  cli.configureOutput({
    writeOut(text: string): void {
      output.push(text);
    },
    writeErr(text: string): void {
      output.push(text);
    },
    outputError(text: string, write: (str: string) => void): void {
      write(text);
    },
  });

  return cli;
}

function formatCliOutput(output: readonly string[], fallback: string): string {
  const joined = output.join('').trimEnd();
  if (joined.length > 0) return joined;
  return fallback.trimEnd();
}

function normalizeCliExitMessage(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  return rawMessage.startsWith('Error:') ? rawMessage : `Error: ${rawMessage}`;
}

function deduplicateAllowedDirectories(dirs: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduplicated: string[] = [];

  for (const dir of dirs) {
    const key = IS_WINDOWS ? dir.toLowerCase() : dir;
    if (seen.has(key)) continue;
    seen.add(key);
    deduplicated.push(dir);
  }

  return deduplicated;
}

export async function parseArgs(): Promise<{
  allowedDirs: string[];
  allowCwd: boolean;
}> {
  const output: string[] = [];
  const cli = createCliProgram(output);
  try {
    cli.parse(process.argv, { from: 'node' });
  } catch (error: unknown) {
    if (error instanceof CommanderError) {
      throw new CliExitError(
        formatCliOutput(output, error.message),
        error.exitCode
      );
    }
    throw error;
  }

  const options = cli.opts<{ allowCwd?: boolean }>();
  const allowCwd = options.allowCwd === true;
  const positionals = getParsedAllowedDirs(cli);

  let allowedDirs: string[];
  try {
    allowedDirs =
      positionals.length > 0 ? await normalizeCliDirectories(positionals) : [];
  } catch (error: unknown) {
    throw new CliExitError(normalizeCliExitMessage(error), 1);
  }

  const deduplicatedDirs = deduplicateAllowedDirectories(allowedDirs);

  return { allowedDirs: deduplicatedDirs, allowCwd };
}
