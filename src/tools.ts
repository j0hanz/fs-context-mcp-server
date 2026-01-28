import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  ContentBlock,
  ProgressNotificationParams,
} from '@modelcontextprotocol/sdk/types.js';

import type { z } from 'zod';

import { formatBytes, formatOperationSummary, joinLines } from './config.js';
import type { FileInfo } from './config.js';
import {
  DEFAULT_EXCLUDE_PATTERNS,
  DEFAULT_SEARCH_TIMEOUT_MS,
  MAX_TEXT_FILE_SIZE,
} from './lib/constants.js';
import {
  createDetailedError,
  ErrorCode,
  formatDetailedError,
  getSuggestion,
  McpError,
} from './lib/errors.js';
import {
  getFileInfo,
  getMultipleFileInfo,
} from './lib/file-operations/file-info.js';
import { listDirectory } from './lib/file-operations/list-directory.js';
import { readMultipleFiles } from './lib/file-operations/read-multiple-files.js';
import { searchContent } from './lib/file-operations/search-content.js';
import type { SearchContentOptions } from './lib/file-operations/search-content.js';
import { searchFiles } from './lib/file-operations/search-files.js';
import { formatTreeAscii, treeDirectory } from './lib/file-operations/tree.js';
import { createTimedAbortSignal, readFile } from './lib/fs-helpers.js';
import { withToolDiagnostics } from './lib/observability.js';
import { getAllowedDirectories } from './lib/path-validation.js';
import type { ResourceStore } from './lib/resource-store.js';
import {
  GetFileInfoInputSchema,
  GetFileInfoOutputSchema,
  GetMultipleFileInfoInputSchema,
  GetMultipleFileInfoOutputSchema,
  ListAllowedDirectoriesInputSchema,
  ListAllowedDirectoriesOutputSchema,
  ListDirectoryInputSchema,
  ListDirectoryOutputSchema,
  ReadFileInputSchema,
  ReadFileOutputSchema,
  ReadMultipleFilesInputSchema,
  ReadMultipleFilesOutputSchema,
  SearchContentInputSchema,
  SearchContentOutputSchema,
  SearchFilesInputSchema,
  SearchFilesOutputSchema,
  TreeInputSchema,
  TreeOutputSchema,
} from './schemas.js';

const MAX_INLINE_CONTENT_CHARS = 20_000;
const MAX_INLINE_PREVIEW_CHARS = 4_000;
const MAX_INLINE_MATCHES = 50;

function buildTextPreview(text: string): string {
  if (text.length <= MAX_INLINE_PREVIEW_CHARS) return text;
  return `${text.slice(0, MAX_INLINE_PREVIEW_CHARS)}\n… [truncated preview]`;
}

function buildResourceLink(params: {
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
}): ContentBlock {
  return {
    type: 'resource_link',
    uri: params.uri,
    name: params.name,
    ...(params.description ? { description: params.description } : {}),
    ...(params.mimeType ? { mimeType: params.mimeType } : {}),
  };
}

function buildContentBlock<T>(
  text: string,
  structuredContent: T,
  extraContent: ContentBlock[] = []
): { content: ContentBlock[]; structuredContent: T } {
  const json = JSON.stringify(structuredContent);
  return {
    content: [
      { type: 'text', text },
      ...extraContent,
      { type: 'text', text: json },
    ],
    structuredContent,
  };
}

function resolveDetailedError(
  error: unknown,
  defaultCode: ErrorCode,
  path?: string
): {
  code: ErrorCode;
  message: string;
  path?: string;
  suggestion?: string;
  details?: Record<string, unknown>;
} {
  const detailed = createDetailedError(error, path);
  if (detailed.code === ErrorCode.E_UNKNOWN) {
    detailed.code = defaultCode;
    detailed.suggestion = getSuggestion(defaultCode);
  }
  return detailed;
}

export function buildToolResponse<T>(
  text: string,
  structuredContent: T,
  extraContent: ContentBlock[] = []
): {
  content: ContentBlock[];
  structuredContent: T;
} {
  return buildContentBlock(text, structuredContent, extraContent);
}

type ToolResponse<T> = ReturnType<typeof buildToolResponse<T>> &
  Record<string, unknown>;

interface ToolErrorStructuredContent extends Record<string, unknown> {
  ok: false;
  error: {
    code: string;
    message: string;
    path?: string;
    suggestion?: string;
  };
}

interface ToolErrorResponse extends Record<string, unknown> {
  content: ContentBlock[];
  structuredContent: ToolErrorStructuredContent;
  isError: true;
}

export type ToolResult<T> = ToolResponse<T> | ToolErrorResponse;

type ProgressToken = string | number;

interface ToolExtra {
  signal?: AbortSignal;
  _meta?: {
    progressToken?: ProgressToken | undefined;
  };
  sendNotification?: (notification: {
    method: 'notifications/progress';
    params: ProgressNotificationParams;
  }) => Promise<void>;
}

interface ToolRegistrationOptions {
  resourceStore?: ResourceStore;
  isInitialized?: () => boolean;
}

const NOT_INITIALIZED_ERROR = new McpError(
  ErrorCode.E_INVALID_INPUT,
  'Client not initialized; wait for notifications/initialized'
);

async function withToolErrorHandling<T>(
  run: () => Promise<ToolResponse<T>>,
  onError: (error: unknown) => ToolResult<T>
): Promise<ToolResult<T>> {
  try {
    return await run();
  } catch (error) {
    return onError(error);
  }
}

export function buildToolErrorResponse(
  error: unknown,
  defaultCode: ErrorCode,
  path?: string
): ToolErrorResponse {
  const detailed = resolveDetailedError(error, defaultCode, path);
  const text = formatDetailedError(detailed);

  const errorContent: ToolErrorStructuredContent['error'] = {
    code: detailed.code,
    message: detailed.message,
  };
  if (detailed.path !== undefined) {
    errorContent.path = detailed.path;
  }
  if (detailed.suggestion !== undefined) {
    errorContent.suggestion = detailed.suggestion;
  }

  const structuredContent: ToolErrorStructuredContent = {
    ok: false,
    error: errorContent,
  };
  return {
    ...buildContentBlock(text, structuredContent),
    isError: true,
  };
}

function buildNotInitializedResult<T>(): ToolResult<T> {
  return buildToolErrorResponse(
    NOT_INITIALIZED_ERROR,
    ErrorCode.E_INVALID_INPUT
  );
}

async function sendProgressNotification(
  extra: ToolExtra,
  params: ProgressNotificationParams
): Promise<void> {
  if (!extra.sendNotification) return;
  try {
    await extra.sendNotification({
      method: 'notifications/progress',
      params,
    });
  } catch {
    // Ignore progress notification failures to avoid breaking tool execution.
  }
}

function resolveToolOk(result: unknown): boolean {
  if (!result || typeof result !== 'object') return true;
  const typed = result as { isError?: unknown; structuredContent?: unknown };
  if (typed.isError === true) return false;
  const structured = typed.structuredContent;
  if (
    structured &&
    typeof structured === 'object' &&
    'ok' in structured &&
    typeof (structured as { ok?: unknown }).ok === 'boolean'
  ) {
    return Boolean((structured as { ok?: boolean }).ok);
  }
  return true;
}

async function withProgress<T>(
  tool: string,
  extra: ToolExtra,
  run: () => Promise<T>
): Promise<T> {
  const token = extra._meta?.progressToken;
  if (!token) {
    return await run();
  }

  const total = 1;
  await sendProgressNotification(extra, {
    progressToken: token,
    progress: 0,
    total,
    message: `${tool} started`,
  });

  try {
    const result = await run();
    const ok = resolveToolOk(result);
    await sendProgressNotification(extra, {
      progressToken: token,
      progress: total,
      total,
      message: ok ? `${tool} completed` : `${tool} failed`,
    });
    return result;
  } catch (error) {
    await sendProgressNotification(extra, {
      progressToken: token,
      progress: total,
      total,
      message: `${tool} failed`,
    });
    throw error;
  }
}

function wrapToolHandler<Args, Result>(
  handler: (args: Args, extra: ToolExtra) => Promise<ToolResult<Result>>,
  options: { guard?: (() => boolean) | undefined; progressTool?: string }
): (args: Args, extra?: ToolExtra) => Promise<ToolResult<Result>> {
  return async (args: Args, extra?: ToolExtra) => {
    const resolvedExtra = extra ?? {};
    if (options.guard && !options.guard()) {
      return buildNotInitializedResult();
    }

    if (options.progressTool) {
      return await withProgress(options.progressTool, resolvedExtra, () =>
        handler(args, resolvedExtra)
      );
    }

    return await handler(args, resolvedExtra);
  };
}

function resolvePathOrRoot(pathValue: string | undefined): string {
  if (pathValue && pathValue.trim().length > 0) return pathValue;
  const firstRoot = getAllowedDirectories()[0];
  if (!firstRoot) {
    throw new McpError(
      ErrorCode.E_ACCESS_DENIED,
      'No workspace roots configured. Use the roots tool to check, or configure roots via the MCP Roots protocol (or start with --allow-cwd / CLI directories).'
    );
  }
  return firstRoot;
}

function buildListTextResult(
  result: Awaited<ReturnType<typeof listDirectory>>
): string {
  const { entries, summary, path } = result;
  if (entries.length === 0) {
    if (!summary.entriesScanned || summary.entriesScanned === 0) {
      return `${path} (empty)`;
    }
    return `${path} (no matches)`;
  }

  const lines = [
    path,
    ...entries.map((entry) => {
      const suffix = entry.type === 'directory' ? '/' : '';
      return `  ${entry.relativePath}${suffix}`;
    }),
  ];

  let truncatedReason: string | undefined;
  if (summary.truncated) {
    if (summary.stoppedReason === 'maxEntries') {
      truncatedReason = `max entries (${summary.totalEntries})`;
    } else {
      truncatedReason = 'aborted';
    }
  }

  const summaryOptions: Parameters<typeof formatOperationSummary>[0] = {
    truncated: summary.truncated,
    ...(truncatedReason ? { truncatedReason } : {}),
  };

  return joinLines(lines) + formatOperationSummary(summaryOptions);
}

function buildSearchTextResult(
  result: Awaited<ReturnType<typeof searchContent>>,
  normalizedMatches: NormalizedSearchMatch[]
): string {
  const { summary } = result;

  if (normalizedMatches.length === 0) return 'No matches';

  let truncatedReason: string | undefined;
  if (summary.truncated) {
    truncatedReason =
      summary.stoppedReason === 'timeout'
        ? 'timeout'
        : `max results (${summary.matches})`;
  }

  const summaryOptions: Parameters<typeof formatOperationSummary>[0] = {
    truncated: summary.truncated,
    ...(truncatedReason ? { truncatedReason } : {}),
  };

  const lines: string[] = [`Found ${normalizedMatches.length}:`];
  for (const match of normalizedMatches) {
    const lineNum = String(match.line).padStart(4);
    lines.push(`  ${match.relativeFile}:${lineNum}: ${match.content}`);
  }

  return joinLines(lines) + formatOperationSummary(summaryOptions);
}

function buildStructuredSearchResult(
  result: Awaited<ReturnType<typeof searchContent>>,
  normalizedMatches: NormalizedSearchMatch[]
): z.infer<typeof SearchContentOutputSchema> {
  return {
    ok: true,
    matches: normalizedMatches.map((match) => ({
      file: match.relativeFile,
      line: match.line,
      content: match.content,
      matchCount: match.matchCount,
      ...(match.contextBefore
        ? { contextBefore: [...match.contextBefore] }
        : {}),
      ...(match.contextAfter ? { contextAfter: [...match.contextAfter] } : {}),
    })),
    totalMatches: result.summary.matches,
    truncated: result.summary.truncated,
  };
}

type SearchContentResultValue = Awaited<ReturnType<typeof searchContent>>;
type NormalizedSearchMatch = SearchContentResultValue['matches'][number] & {
  relativeFile: string;
  index: number;
};

function normalizeSearchMatches(
  result: SearchContentResultValue
): NormalizedSearchMatch[] {
  const relativeByFile = new Map<string, string>();
  const normalized = result.matches.map((match, index) => {
    const cached = relativeByFile.get(match.file);
    const relative = cached ?? path.relative(result.basePath, match.file);
    if (!cached) relativeByFile.set(match.file, relative);
    return {
      ...match,
      relativeFile: relative,
      index,
    };
  });
  normalized.sort((a, b) => {
    const fileCompare = a.relativeFile.localeCompare(b.relativeFile);
    if (fileCompare !== 0) return fileCompare;
    if (a.line !== b.line) return a.line - b.line;
    return a.index - b.index;
  });
  return normalized;
}

interface FileInfoPayload {
  name: string;
  path: string;
  type: FileInfo['type'];
  size: number;
  tokenEstimate?: number;
  created: string;
  modified: string;
  accessed: string;
  permissions: string;
  isHidden: boolean;
  mimeType?: string;
  symlinkTarget?: string;
}

function buildFileInfoPayload(info: FileInfo): FileInfoPayload {
  return {
    name: info.name,
    path: info.path,
    type: info.type,
    size: info.size,
    ...(info.tokenEstimate !== undefined
      ? { tokenEstimate: info.tokenEstimate }
      : {}),
    created: info.created.toISOString(),
    modified: info.modified.toISOString(),
    accessed: info.accessed.toISOString(),
    permissions: info.permissions,
    isHidden: info.isHidden,
    ...(info.mimeType !== undefined ? { mimeType: info.mimeType } : {}),
    ...(info.symlinkTarget !== undefined
      ? { symlinkTarget: info.symlinkTarget }
      : {}),
  };
}

function formatFileInfoDetails(info: FileInfo): string {
  const lines = [
    `${info.name} (${info.type})`,
    `  Path: ${info.path}`,
    `  Size: ${formatBytes(info.size)}`,
    `  Modified: ${info.modified.toISOString()}`,
  ];

  if (info.mimeType) lines.push(`  Type: ${info.mimeType}`);
  if (info.symlinkTarget) lines.push(`  Target: ${info.symlinkTarget}`);

  return joinLines(lines);
}

function formatFileInfoSummary(pathValue: string, info: FileInfo): string {
  return `${pathValue} (${info.type}, ${formatBytes(info.size)})`;
}

const LIST_ALLOWED_DIRECTORIES_TOOL = {
  title: 'Workspace Roots',
  description:
    'List the workspace roots this server can access. ' +
    'Call this first to see available directories. ' +
    'All other tools only work within these directories.',
  inputSchema: ListAllowedDirectoriesInputSchema,
  outputSchema: ListAllowedDirectoriesOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

const LIST_DIRECTORY_TOOL = {
  title: 'List Directory',
  description:
    'List the immediate contents of a directory (non-recursive). ' +
    'Returns name, relative path, type (file/directory/symlink), size, and modified date. ' +
    'Omit path to list the workspace root. ' +
    'Use includeIgnored=true to include ignored directories like node_modules. ' +
    'For recursive searches, use find instead.',
  inputSchema: ListDirectoryInputSchema,
  outputSchema: ListDirectoryOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

const SEARCH_FILES_TOOL = {
  title: 'Find Files',
  description:
    'Find files by glob pattern (e.g., **/*.ts). ' +
    'Returns a list of matching files with metadata. ' +
    'For text search inside files, use grep.',
  inputSchema: SearchFilesInputSchema,
  outputSchema: SearchFilesOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

const TREE_TOOL = {
  title: 'Tree',
  description:
    'Render a directory tree (bounded recursion). ' +
    'Returns an ASCII tree for quick scanning and a structured JSON tree for programmatic use.',
  inputSchema: TreeInputSchema,
  outputSchema: TreeOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

const READ_FILE_TOOL = {
  title: 'Read File',
  description:
    'Read the text contents of a file. ' +
    'Use head parameter to preview the first N lines of large files. ' +
    'For multiple files, use read_many for efficiency.',
  inputSchema: ReadFileInputSchema,
  outputSchema: ReadFileOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

const READ_MULTIPLE_FILES_TOOL = {
  title: 'Read Multiple Files',
  description:
    'Read multiple text files in a single request. ' +
    'Returns contents and metadata for each file. ' +
    'For single file, use read for simpler output.',
  inputSchema: ReadMultipleFilesInputSchema,
  outputSchema: ReadMultipleFilesOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

const GET_FILE_INFO_TOOL = {
  title: 'Get File Info',
  description:
    'Get metadata (size, modified time, permissions, mime type) for a file or directory.',
  inputSchema: GetFileInfoInputSchema,
  outputSchema: GetFileInfoOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

const GET_MULTIPLE_FILE_INFO_TOOL = {
  title: 'Get Multiple File Info',
  description: 'Get metadata for multiple files or directories in one request.',
  inputSchema: GetMultipleFileInfoInputSchema,
  outputSchema: GetMultipleFileInfoOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

const SEARCH_CONTENT_TOOL = {
  title: 'Search Content',
  description:
    'Search for text within file contents (grep-like). ' +
    'Returns matching lines. ' +
    'Path may be a directory or a single file. ' +
    'Use includeHidden=true to include hidden files and directories.',
  inputSchema: SearchContentInputSchema,
  outputSchema: SearchContentOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

function buildTextRoots(dirs: string[]): string {
  if (dirs.length === 0) {
    return 'No directories configured';
  }
  return joinLines([
    `${dirs.length} workspace roots:`,
    ...dirs.map((d) => `  ${d}`),
  ]);
}

function handleListAllowedDirectories(): ToolResponse<
  z.infer<typeof ListAllowedDirectoriesOutputSchema>
> {
  const dirs = getAllowedDirectories();
  const structured = {
    ok: true,
    directories: dirs,
  } as const;
  return buildToolResponse(buildTextRoots(dirs), structured);
}

export function registerListAllowedDirectoriesTool(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  const handler = (): Promise<
    ToolResult<z.infer<typeof ListAllowedDirectoriesOutputSchema>>
  > =>
    withToolErrorHandling(
      () =>
        withToolDiagnostics('roots', () =>
          Promise.resolve(handleListAllowedDirectories())
        ),
      (error) => buildToolErrorResponse(error, ErrorCode.E_UNKNOWN)
    );

  server.registerTool(
    'roots',
    LIST_ALLOWED_DIRECTORIES_TOOL,
    wrapToolHandler(handler, { guard: options.isInitialized })
  );
}

function buildStructuredListEntry(
  entry: Awaited<ReturnType<typeof listDirectory>>['entries'][number]
): NonNullable<z.infer<typeof ListDirectoryOutputSchema>['entries']>[number] {
  return {
    name: entry.name,
    relativePath: entry.relativePath,
    type: entry.type,
    size: entry.size,
    modified: entry.modified?.toISOString(),
  };
}

function buildStructuredListResult(
  result: Awaited<ReturnType<typeof listDirectory>>
): z.infer<typeof ListDirectoryOutputSchema> {
  const { entries, summary, path: resultPath } = result;
  return {
    ok: true,
    path: resultPath,
    entries: entries.map(buildStructuredListEntry),
    totalEntries: summary.totalEntries,
  };
}

async function handleListDirectory(
  args: z.infer<typeof ListDirectoryInputSchema>,
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof ListDirectoryOutputSchema>>> {
  const dirPath = resolvePathOrRoot(args.path);
  const options: Parameters<typeof listDirectory>[1] = {
    includeHidden: args.includeHidden,
    excludePatterns: args.includeIgnored ? [] : DEFAULT_EXCLUDE_PATTERNS,
    ...(signal ? { signal } : {}),
  };
  const result = await listDirectory(dirPath, options);
  return buildToolResponse(
    buildListTextResult(result),
    buildStructuredListResult(result)
  );
}

export function registerListDirectoryTool(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  const handler = (
    args: z.infer<typeof ListDirectoryInputSchema>,
    extra: ToolExtra
  ): Promise<ToolResult<z.infer<typeof ListDirectoryOutputSchema>>> =>
    withToolDiagnostics(
      'ls',
      () =>
        withToolErrorHandling(
          () => handleListDirectory(args, extra.signal),
          (error) =>
            buildToolErrorResponse(
              error,
              ErrorCode.E_NOT_DIRECTORY,
              args.path ?? '.'
            )
        ),
      { path: args.path ?? '.' }
    );

  server.registerTool(
    'ls',
    LIST_DIRECTORY_TOOL,
    wrapToolHandler(handler, { guard: options.isInitialized })
  );
}

async function handleSearchFiles(
  args: z.infer<typeof SearchFilesInputSchema>,
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof SearchFilesOutputSchema>>> {
  const basePath = resolvePathOrRoot(args.path);
  const excludePatterns = args.includeIgnored ? [] : DEFAULT_EXCLUDE_PATTERNS;
  const result = await searchFiles(basePath, args.pattern, excludePatterns, {
    maxResults: args.maxResults,
    respectGitignore: !args.includeIgnored,
    ...(signal ? { signal } : {}),
  });
  const relativeResults = result.results.map((entry) => ({
    path: path.relative(result.basePath, entry.path),
    size: entry.size,
    modified: entry.modified?.toISOString(),
  }));
  const structured: z.infer<typeof SearchFilesOutputSchema> = {
    ok: true,
    results: relativeResults,
    totalMatches: result.summary.matched,
    truncated: result.summary.truncated,
  };

  let truncatedReason: string | undefined;
  if (result.summary.truncated) {
    if (result.summary.stoppedReason === 'timeout') {
      truncatedReason = 'timeout';
    } else if (result.summary.stoppedReason === 'maxFiles') {
      truncatedReason = `max files (${result.summary.filesScanned})`;
    } else {
      truncatedReason = `max results (${result.summary.matched})`;
    }
  }

  const summaryOptions: Parameters<typeof formatOperationSummary>[0] = {
    truncated: result.summary.truncated,
    ...(truncatedReason ? { truncatedReason } : {}),
  };

  const textLines =
    relativeResults.length === 0
      ? ['No matches']
      : [
          `Found ${relativeResults.length}:`,
          ...relativeResults.map((entry) => `  ${entry.path}`),
        ];

  const text = joinLines(textLines) + formatOperationSummary(summaryOptions);
  return buildToolResponse(text, structured);
}

function registerSearchFilesTool(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  const handler = (
    args: z.infer<typeof SearchFilesInputSchema>,
    extra: ToolExtra
  ): Promise<ToolResult<z.infer<typeof SearchFilesOutputSchema>>> =>
    withToolDiagnostics(
      'find',
      () =>
        withToolErrorHandling(
          async () => {
            const { signal, cleanup } = createTimedAbortSignal(
              extra.signal,
              DEFAULT_SEARCH_TIMEOUT_MS
            );
            try {
              return await handleSearchFiles(args, signal);
            } finally {
              cleanup();
            }
          },
          (error) =>
            buildToolErrorResponse(
              error,
              ErrorCode.E_INVALID_PATTERN,
              args.path
            )
        ),
      { path: args.path ?? '.' }
    );

  server.registerTool(
    'find',
    SEARCH_FILES_TOOL,
    wrapToolHandler(handler, {
      guard: options.isInitialized,
      progressTool: 'find',
    })
  );
}

async function handleTree(
  args: z.infer<typeof TreeInputSchema>,
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof TreeOutputSchema>>> {
  const basePath = resolvePathOrRoot(args.path);
  const result = await treeDirectory(basePath, {
    maxDepth: args.maxDepth,
    maxEntries: args.maxEntries,
    includeHidden: args.includeHidden,
    includeIgnored: args.includeIgnored,
    ...(signal ? { signal } : {}),
  });

  const ascii = formatTreeAscii(result.tree);

  const structured: z.infer<typeof TreeOutputSchema> = {
    ok: true,
    root: result.root,
    tree: result.tree,
    ascii,
    truncated: result.truncated,
    totalEntries: result.totalEntries,
  };

  const text = result.truncated ? `${ascii}\n[truncated]` : ascii;
  return buildToolResponse(text, structured);
}

function registerTreeTool(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  const handler = (
    args: z.infer<typeof TreeInputSchema>,
    extra: ToolExtra
  ): Promise<ToolResult<z.infer<typeof TreeOutputSchema>>> => {
    const targetPath = args.path ?? '.';
    return withToolDiagnostics(
      'tree',
      () =>
        withToolErrorHandling(
          async () => {
            const { signal, cleanup } = createTimedAbortSignal(
              extra.signal,
              DEFAULT_SEARCH_TIMEOUT_MS
            );
            try {
              return await handleTree(args, signal);
            } finally {
              cleanup();
            }
          },
          (error) =>
            buildToolErrorResponse(error, ErrorCode.E_NOT_DIRECTORY, targetPath)
        ),
      { path: targetPath }
    );
  };

  server.registerTool(
    'tree',
    TREE_TOOL,
    wrapToolHandler(handler, {
      guard: options.isInitialized,
      progressTool: 'tree',
    })
  );
}

async function handleReadFile(
  args: z.infer<typeof ReadFileInputSchema>,
  signal?: AbortSignal,
  resourceStore?: ResourceStore
): Promise<ToolResponse<z.infer<typeof ReadFileOutputSchema>>> {
  const options: Parameters<typeof readFile>[1] = {
    encoding: 'utf-8',
    maxSize: MAX_TEXT_FILE_SIZE,
    skipBinary: true,
  };
  if (args.head !== undefined) {
    options.head = args.head;
  }
  if (args.startLine !== undefined) {
    options.startLine = args.startLine;
  }
  if (args.endLine !== undefined) {
    options.endLine = args.endLine;
  }
  if (signal) {
    options.signal = signal;
  }
  const result = await readFile(args.path, options);

  const structured: z.infer<typeof ReadFileOutputSchema> = {
    ok: true,
    path: args.path,
    content: result.content,
    truncated: result.truncated,
    resourceUri: undefined,
    totalLines: result.totalLines,
    readMode: result.readMode,
    head: result.head,
    startLine: result.startLine,
    endLine: result.endLine,
    linesRead: result.linesRead,
    hasMoreLines: result.hasMoreLines,
  };

  if (!resourceStore || result.content.length <= MAX_INLINE_CONTENT_CHARS) {
    return buildToolResponse(result.content, structured);
  }

  const entry = resourceStore.putText({
    name: `read:${path.basename(args.path)}`,
    mimeType: 'text/plain',
    text: result.content,
  });

  const preview = buildTextPreview(result.content);
  const structuredWithResource: z.infer<typeof ReadFileOutputSchema> = {
    ...structured,
    content: preview,
    truncated: true,
    resourceUri: entry.uri,
  };

  const text = joinLines([
    `Output too large to inline (${result.content.length} chars).`,
    'Preview:',
    preview,
  ]);

  return buildToolResponse(text, structuredWithResource, [
    buildResourceLink({
      uri: entry.uri,
      name: entry.name,
      mimeType: entry.mimeType,
      description: 'Full file contents',
    }),
  ]);
}

function registerReadFileTool(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  const handler = (
    args: z.infer<typeof ReadFileInputSchema>,
    extra: ToolExtra
  ): Promise<ToolResult<z.infer<typeof ReadFileOutputSchema>>> =>
    withToolDiagnostics(
      'read',
      () =>
        withToolErrorHandling(
          async () => {
            const { signal, cleanup } = createTimedAbortSignal(
              extra.signal,
              DEFAULT_SEARCH_TIMEOUT_MS
            );
            try {
              return await handleReadFile(args, signal, options.resourceStore);
            } finally {
              cleanup();
            }
          },
          (error) =>
            buildToolErrorResponse(error, ErrorCode.E_NOT_FILE, args.path)
        ),
      { path: args.path }
    );

  server.registerTool(
    'read',
    READ_FILE_TOOL,
    wrapToolHandler(handler, { guard: options.isInitialized })
  );
}

async function handleReadMultipleFiles(
  args: z.infer<typeof ReadMultipleFilesInputSchema>,
  signal?: AbortSignal,
  resourceStore?: ResourceStore
): Promise<ToolResponse<z.infer<typeof ReadMultipleFilesOutputSchema>>> {
  const options: Parameters<typeof readMultipleFiles>[1] = {
    ...(signal ? { signal } : {}),
  };
  if (args.head !== undefined) {
    options.head = args.head;
  }
  if (args.startLine !== undefined) {
    options.startLine = args.startLine;
  }
  if (args.endLine !== undefined) {
    options.endLine = args.endLine;
  }
  const results = await readMultipleFiles(args.paths, options);

  type ReadManyResult = Awaited<ReturnType<typeof readMultipleFiles>>[number];
  type ReadManyResultWithResource = ReadManyResult & { resourceUri?: string };

  const mappedResults: ReadManyResultWithResource[] = results.map(
    (result): ReadManyResultWithResource => {
      if (!resourceStore || !result.content) {
        return result;
      }
      if (result.content.length <= MAX_INLINE_CONTENT_CHARS) {
        return result;
      }

      const entry = resourceStore.putText({
        name: `read:${path.basename(result.path)}`,
        mimeType: 'text/plain',
        text: result.content,
      });

      return {
        ...result,
        content: buildTextPreview(result.content),
        truncated: true,
        resourceUri: entry.uri,
      };
    }
  );

  const structured: z.infer<typeof ReadMultipleFilesOutputSchema> = {
    ok: true,
    results: mappedResults.map((result) => ({
      path: result.path,
      content: result.content,
      truncated: result.truncated,
      resourceUri: result.resourceUri,
      readMode: result.readMode,
      head: result.head,
      startLine: result.startLine,
      endLine: result.endLine,
      linesRead: result.linesRead,
      hasMoreLines: result.hasMoreLines,
      totalLines: result.totalLines,
      error: result.error,
    })),
    summary: {
      total: mappedResults.length,
      succeeded: mappedResults.filter((r) => r.error === undefined).length,
      failed: mappedResults.filter((r) => r.error !== undefined).length,
    },
  };

  const resourceLinks = mappedResults.flatMap((result) => {
    if (!result.resourceUri) return [];
    return [
      buildResourceLink({
        uri: result.resourceUri,
        name: `read:${path.basename(result.path)}`,
        description: 'Full file contents',
      }),
    ];
  });

  const text = joinLines(
    mappedResults.map((result) => {
      if (result.error) {
        return `${result.path}: ${result.error}`;
      }
      return result.path;
    })
  );

  return buildToolResponse(text, structured, resourceLinks);
}

function registerReadMultipleFilesTool(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  const handler = (
    args: z.infer<typeof ReadMultipleFilesInputSchema>,
    extra: ToolExtra
  ): Promise<ToolResult<z.infer<typeof ReadMultipleFilesOutputSchema>>> => {
    const primaryPath = args.paths[0] ?? '';
    return withToolDiagnostics(
      'read_many',
      () =>
        withToolErrorHandling(
          async () => {
            const { signal, cleanup } = createTimedAbortSignal(
              extra.signal,
              DEFAULT_SEARCH_TIMEOUT_MS
            );
            try {
              return await handleReadMultipleFiles(
                args,
                signal,
                options.resourceStore
              );
            } finally {
              cleanup();
            }
          },
          (error) =>
            buildToolErrorResponse(error, ErrorCode.E_NOT_FILE, primaryPath)
        ),
      { path: primaryPath }
    );
  };

  server.registerTool(
    'read_many',
    READ_MULTIPLE_FILES_TOOL,
    wrapToolHandler(handler, { guard: options.isInitialized })
  );
}

async function handleGetFileInfo(
  args: z.infer<typeof GetFileInfoInputSchema>,
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof GetFileInfoOutputSchema>>> {
  const info = await getFileInfo(args.path, {
    includeMimeType: true,
    ...(signal ? { signal } : {}),
  });

  const structured: z.infer<typeof GetFileInfoOutputSchema> = {
    ok: true,
    info: buildFileInfoPayload(info),
  };

  return buildToolResponse(formatFileInfoDetails(info), structured);
}

function registerGetFileInfoTool(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  const handler = (
    args: z.infer<typeof GetFileInfoInputSchema>,
    extra: ToolExtra
  ): Promise<ToolResult<z.infer<typeof GetFileInfoOutputSchema>>> =>
    withToolDiagnostics(
      'stat',
      () =>
        withToolErrorHandling(
          async () => {
            const { signal, cleanup } = createTimedAbortSignal(
              extra.signal,
              DEFAULT_SEARCH_TIMEOUT_MS
            );
            try {
              return await handleGetFileInfo(args, signal);
            } finally {
              cleanup();
            }
          },
          (error) =>
            buildToolErrorResponse(error, ErrorCode.E_NOT_FOUND, args.path)
        ),
      { path: args.path }
    );

  server.registerTool(
    'stat',
    GET_FILE_INFO_TOOL,
    wrapToolHandler(handler, { guard: options.isInitialized })
  );
}

async function handleGetMultipleFileInfo(
  args: z.infer<typeof GetMultipleFileInfoInputSchema>,
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof GetMultipleFileInfoOutputSchema>>> {
  const result = await getMultipleFileInfo(args.paths, {
    includeMimeType: true,
    ...(signal ? { signal } : {}),
  });

  const structured: z.infer<typeof GetMultipleFileInfoOutputSchema> = {
    ok: true,
    results: result.results.map((entry) => ({
      path: entry.path,
      info: entry.info ? buildFileInfoPayload(entry.info) : undefined,
      error: entry.error,
    })),
    summary: {
      total: result.summary.total,
      succeeded: result.summary.succeeded,
      failed: result.summary.failed,
    },
  };

  const text = joinLines(
    result.results.map((entry) => {
      if (entry.error) {
        return `${entry.path}: ${entry.error}`;
      }
      if (entry.info) {
        return formatFileInfoSummary(entry.path, entry.info);
      }
      return entry.path;
    })
  );

  return buildToolResponse(text, structured);
}

function registerGetMultipleFileInfoTool(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  const handler = (
    args: z.infer<typeof GetMultipleFileInfoInputSchema>,
    extra: ToolExtra
  ): Promise<ToolResult<z.infer<typeof GetMultipleFileInfoOutputSchema>>> => {
    const primaryPath = args.paths[0] ?? '';
    return withToolDiagnostics(
      'stat_many',
      () =>
        withToolErrorHandling(
          async () => {
            const { signal, cleanup } = createTimedAbortSignal(
              extra.signal,
              DEFAULT_SEARCH_TIMEOUT_MS
            );
            try {
              return await handleGetMultipleFileInfo(args, signal);
            } finally {
              cleanup();
            }
          },
          (error) =>
            buildToolErrorResponse(error, ErrorCode.E_NOT_FOUND, primaryPath)
        ),
      { path: primaryPath }
    );
  };

  server.registerTool(
    'stat_many',
    GET_MULTIPLE_FILE_INFO_TOOL,
    wrapToolHandler(handler, { guard: options.isInitialized })
  );
}

async function handleSearchContent(
  args: z.infer<typeof SearchContentInputSchema>,
  signal?: AbortSignal,
  resourceStore?: ResourceStore,
  onProgress?: (progress: { total?: number; current: number }) => void
): Promise<ToolResponse<z.infer<typeof SearchContentOutputSchema>>> {
  const basePath = resolvePathOrRoot(args.path);
  const options: SearchContentOptions = {
    includeHidden: args.includeHidden,
  };
  if (signal) {
    options.signal = signal;
  }
  if (onProgress) {
    options.onProgress = onProgress;
  }

  const result = await searchContent(basePath, args.pattern, options);
  const normalizedMatches = normalizeSearchMatches(result);
  const structuredFull = buildStructuredSearchResult(result, normalizedMatches);
  const needsExternalize = normalizedMatches.length > MAX_INLINE_MATCHES;

  if (!resourceStore || !needsExternalize) {
    return buildToolResponse(
      buildSearchTextResult(result, normalizedMatches),
      structuredFull
    );
  }

  const previewMatches = normalizedMatches.slice(0, MAX_INLINE_MATCHES);
  const previewStructured: z.infer<typeof SearchContentOutputSchema> = {
    ok: true,
    matches: previewMatches.map((match) => ({
      file: match.relativeFile,
      line: match.line,
      content: match.content,
      matchCount: match.matchCount,
      ...(match.contextBefore
        ? { contextBefore: [...match.contextBefore] }
        : {}),
      ...(match.contextAfter ? { contextAfter: [...match.contextAfter] } : {}),
    })),
    totalMatches: structuredFull.totalMatches,
    truncated: true,
    resourceUri: undefined,
  };

  const entry = resourceStore.putText({
    name: 'grep:matches',
    mimeType: 'application/json',
    text: JSON.stringify(structuredFull),
  });

  previewStructured.resourceUri = entry.uri;

  const text = joinLines([
    `Found ${normalizedMatches.length} (showing first ${MAX_INLINE_MATCHES}):`,
    ...previewMatches.map((match) => {
      const lineNum = String(match.line).padStart(4);
      return `  ${match.relativeFile}:${lineNum}: ${match.content}`;
    }),
  ]);

  return buildToolResponse(text, previewStructured, [
    buildResourceLink({
      uri: entry.uri,
      name: entry.name,
      mimeType: entry.mimeType,
      description: 'Full grep results as JSON (structuredContent)',
    }),
  ]);
}

function createProgressReporter(
  extra: ToolExtra
): (progress: { total?: number; current: number }) => void {
  return (progress) => {
    const token = extra._meta?.progressToken;
    if (token && extra.sendNotification) {
      void extra.sendNotification({
        method: 'notifications/progress',
        params: {
          progressToken: token,
          total: progress.total,
          progress: progress.current,
        },
      });
    }
  };
}

function registerSearchContentTool(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  const handler = (
    args: z.infer<typeof SearchContentInputSchema>,
    extra: ToolExtra
  ): Promise<ToolResult<z.infer<typeof SearchContentOutputSchema>>> =>
    withToolDiagnostics(
      'grep',
      () =>
        withToolErrorHandling(
          async () =>
            handleSearchContent(
              args,
              extra.signal,
              options.resourceStore,
              createProgressReporter(extra)
            ),
          (error) =>
            buildToolErrorResponse(error, ErrorCode.E_UNKNOWN, args.path ?? '.')
        ),
      { path: args.path ?? '.' }
    );

  server.registerTool(
    'grep',
    SEARCH_CONTENT_TOOL,
    wrapToolHandler(handler, {
      guard: options.isInitialized,
      progressTool: 'grep',
    })
  );
}

export function registerAllTools(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  registerListAllowedDirectoriesTool(server, options);
  registerListDirectoryTool(server, options);
  registerSearchFilesTool(server, options);
  registerTreeTool(server, options);
  registerReadFileTool(server, options);
  registerReadMultipleFilesTool(server, options);
  registerGetFileInfoTool(server, options);
  registerGetMultipleFileInfoTool(server, options);
  registerSearchContentTool(server, options);
}
