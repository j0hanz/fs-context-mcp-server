import * as fs from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { getSystemErrorMessage, getSystemErrorName } from 'node:util';

import { z } from 'zod';

import { Command, CommanderError } from 'commander';

import packageJsonRaw from '../package.json' with { type: 'json' };
import {
  getReservedDeviceNameForPath,
  isWindowsDriveRelativePath,
  normalizePath,
} from './lib/path-validation.js';

const PackageJsonSchema = z.object({ version: z.string() });
const { version: SERVER_VERSION } = PackageJsonSchema.parse(packageJsonRaw);

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

function assertDirectory(stats: Stats, inputPath: string): void {
  if (stats.isDirectory()) return;
  throw new Error(`Error: ${inputPath} is not a directory`);
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

async function normalizeCliDirectories(
  args: readonly string[]
): Promise<string[]> {
  return Promise.all(args.map(validateDirectoryPath));
}

function createCliProgram(output: string[]): Command {
  const cli = new Command();
  cli
    .name('fs-context-mcp')
    .usage('[options] [allowedDirs...]')
    .description(
      'MCP filesystem server. Positional directories define allowed access roots.'
    )
    .argument(
      '[allowedDirs...]',
      'Directories the MCP server can access on disk'
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
  $ fs-context-mcp /path/to/allowed/dir
  $ fs-context-mcp --allow-cwd
  $ fs-context-mcp /project/src /project/tests --allow-cwd
`
    );

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

export interface ParseArgsResult {
  allowedDirs: string[];
  allowCwd: boolean;
}

export async function parseArgs(): Promise<ParseArgsResult> {
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
  const positionals = cli.args;
  const allowedDirs =
    positionals.length > 0 ? await normalizeCliDirectories(positionals) : [];
  const deduplicatedDirs = Array.from(new Set(allowedDirs));

  return { allowedDirs: deduplicatedDirs, allowCwd };
}
