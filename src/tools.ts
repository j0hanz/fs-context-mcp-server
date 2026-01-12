import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import { formatBytes, formatOperationSummary, joinLines } from './config.js';
import type { FileInfo } from './config.js';
import {
  DEFAULT_EXCLUDE_PATTERNS,
  DEFAULT_SEARCH_TIMEOUT_MS,
  MAX_SEARCHABLE_FILE_SIZE,
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
import { searchFiles } from './lib/file-operations/search-files.js';
import { createTimedAbortSignal, readFile } from './lib/fs-helpers.js';
import { withToolDiagnostics } from './lib/observability.js';
import { getAllowedDirectories } from './lib/path-validation.js';
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
} from './schemas.js';

function buildContentBlock<T>(
  text: string,
  structuredContent: T
): { content: { type: 'text'; text: string }[]; structuredContent: T } {
  const json = JSON.stringify(structuredContent);
  return {
    content: [
      { type: 'text', text },
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
  structuredContent: T
): {
  content: { type: 'text'; text: string }[];
  structuredContent: T;
} {
  return buildContentBlock(text, structuredContent);
}

export type ToolResponse<T> = ReturnType<typeof buildToolResponse<T>> &
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
  content: { type: 'text'; text: string }[];
  structuredContent: ToolErrorStructuredContent;
  isError: true;
}

export type ToolResult<T> = ToolResponse<T> | ToolErrorResponse;

export async function withToolErrorHandling<T>(
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
  result: Awaited<ReturnType<typeof searchContent>>
): string {
  const { summary } = result;
  const normalizedMatches = normalizeSearchMatches(result);

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

  return (
    joinLines([
      `Found ${normalizedMatches.length}:`,
      ...normalizedMatches.map((match) => {
        const lineNum = String(match.line).padStart(4);
        return `  ${match.relativeFile}:${lineNum}: ${match.content}`;
      }),
    ]) + formatOperationSummary(summaryOptions)
  );
}

function buildStructuredSearchResult(
  result: Awaited<ReturnType<typeof searchContent>>
): z.infer<typeof SearchContentOutputSchema> {
  const normalizedMatches = normalizeSearchMatches(result);

  return {
    ok: true,
    matches: normalizedMatches.map((match) => ({
      file: match.relativeFile,
      line: match.line,
      content: match.content,
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
    'For recursive searches, use find instead.',
  inputSchema: ListDirectoryInputSchema,
  outputSchema: ListDirectoryOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
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
    openWorldHint: true,
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
    openWorldHint: true,
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
    openWorldHint: true,
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
    openWorldHint: true,
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
    openWorldHint: true,
  },
} as const;

const SEARCH_CONTENT_TOOL = {
  title: 'Search Content',
  description:
    'Search for text within file contents (grep-like). ' +
    'Returns matching lines. ' +
    'Use includeIgnored=true to search in node_modules/dist for debugging.',
  inputSchema: SearchContentInputSchema,
  outputSchema: SearchContentOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
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

export function registerListAllowedDirectoriesTool(server: McpServer): void {
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

  server.registerTool('roots', LIST_ALLOWED_DIRECTORIES_TOOL, handler);
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
    excludePatterns: args.excludePatterns,
    maxDepth: args.maxDepth,
    maxEntries: args.maxEntries,
    timeoutMs: args.timeoutMs,
    sortBy: args.sortBy,
    includeSymlinkTargets: args.includeSymlinkTargets,
    ...(args.pattern !== undefined ? { pattern: args.pattern } : {}),
    ...(signal ? { signal } : {}),
  };
  const result = await listDirectory(dirPath, options);
  return buildToolResponse(
    buildListTextResult(result),
    buildStructuredListResult(result)
  );
}

export function registerListDirectoryTool(server: McpServer): void {
  server.registerTool('ls', LIST_DIRECTORY_TOOL, (args, extra) =>
    withToolDiagnostics(
      'ls',
      () =>
        withToolErrorHandling(
          async () => {
            const { signal, cleanup } = createTimedAbortSignal(
              extra.signal,
              args.timeoutMs
            );
            try {
              return await handleListDirectory(args, signal);
            } finally {
              cleanup();
            }
          },
          (error) =>
            buildToolErrorResponse(
              error,
              ErrorCode.E_NOT_DIRECTORY,
              args.path ?? '.'
            )
        ),
      { path: args.path ?? '.' }
    )
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
    ...(signal ? { signal } : {}),
  });
  const structured: z.infer<typeof SearchFilesOutputSchema> = {
    ok: true,
    results: result.results.map((entry) => ({
      path: path.relative(result.basePath, entry.path),
      size: entry.size,
      modified: entry.modified?.toISOString(),
    })),
    totalMatches: result.summary.matched,
    truncated: result.summary.truncated,
  };
  const text = joinLines([
    `Found ${result.results.length}:`,
    ...result.results.map((entry) => `  ${entry.path}`),
  ]);
  return buildToolResponse(text, structured);
}

export function registerSearchFilesTool(server: McpServer): void {
  server.registerTool('find', SEARCH_FILES_TOOL, (args, extra) =>
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
    )
  );
}

async function handleReadFile(
  args: z.infer<typeof ReadFileInputSchema>,
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof ReadFileOutputSchema>>> {
  const options: Parameters<typeof readFile>[1] = {
    encoding: 'utf-8',
    maxSize: MAX_TEXT_FILE_SIZE,
    skipBinary: true,
  };
  if (args.head !== undefined) {
    options.head = args.head;
  }
  if (signal) {
    options.signal = signal;
  }
  const result = await readFile(args.path, options);

  const structured = {
    ok: true,
    path: args.path,
    content: result.content,
    truncated: result.truncated,
    totalLines: result.totalLines,
  } as const;

  return buildToolResponse(result.content, structured);
}

export function registerReadFileTool(server: McpServer): void {
  const handler = (
    args: z.infer<typeof ReadFileInputSchema>,
    extra: { signal?: AbortSignal }
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
              return await handleReadFile(args, signal);
            } finally {
              cleanup();
            }
          },
          (error) =>
            buildToolErrorResponse(error, ErrorCode.E_NOT_FILE, args.path)
        ),
      { path: args.path }
    );

  server.registerTool('read', READ_FILE_TOOL, handler);
}

async function handleReadMultipleFiles(
  args: z.infer<typeof ReadMultipleFilesInputSchema>,
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof ReadMultipleFilesOutputSchema>>> {
  const options: Parameters<typeof readMultipleFiles>[1] = {
    ...(signal ? { signal } : {}),
  };
  if (args.head !== undefined) {
    options.head = args.head;
  }
  const results = await readMultipleFiles(args.paths, options);

  const structured: z.infer<typeof ReadMultipleFilesOutputSchema> = {
    ok: true,
    results: results.map((result) => ({
      path: result.path,
      content: result.content,
      truncated: result.truncated,
      error: result.error,
    })),
    summary: {
      total: results.length,
      succeeded: results.filter((r) => r.error === undefined).length,
      failed: results.filter((r) => r.error !== undefined).length,
    },
  };

  const text = joinLines(
    results.map((result) => {
      if (result.error) {
        return `${result.path}: ${result.error}`;
      }
      return result.path;
    })
  );

  return buildToolResponse(text, structured);
}

export function registerReadMultipleFilesTool(server: McpServer): void {
  server.registerTool('read_many', READ_MULTIPLE_FILES_TOOL, (args, extra) => {
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
              return await handleReadMultipleFiles(args, signal);
            } finally {
              cleanup();
            }
          },
          (error) =>
            buildToolErrorResponse(error, ErrorCode.E_NOT_FILE, primaryPath)
        ),
      { path: primaryPath }
    );
  });
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

export function registerGetFileInfoTool(server: McpServer): void {
  server.registerTool('stat', GET_FILE_INFO_TOOL, (args, extra) =>
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
    )
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

export function registerGetMultipleFileInfoTool(server: McpServer): void {
  server.registerTool(
    'stat_many',
    GET_MULTIPLE_FILE_INFO_TOOL,
    (args, extra) => {
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
    }
  );
}

function resolveExcludePatterns(
  args: z.infer<typeof SearchContentInputSchema>
): readonly string[] {
  if (args.excludePatterns) return args.excludePatterns;
  return args.includeIgnored ? [] : DEFAULT_EXCLUDE_PATTERNS;
}

function resolveMaxFileSize(
  args: z.infer<typeof SearchContentInputSchema>
): number {
  if (typeof args.maxFileSize !== 'number') {
    return MAX_SEARCHABLE_FILE_SIZE;
  }
  return Math.min(args.maxFileSize, MAX_SEARCHABLE_FILE_SIZE);
}

function buildSearchOptions(
  args: z.infer<typeof SearchContentInputSchema>,
  signal?: AbortSignal
): Parameters<typeof searchContent>[2] {
  const includeHidden = args.includeHidden || args.includeIgnored;
  const options = {
    filePattern: args.filePattern,
    excludePatterns: resolveExcludePatterns(args),
    caseSensitive: args.caseSensitive,
    isLiteral: args.isLiteral,
    contextLines: args.contextLines,
    maxResults: args.maxResults,
    maxFileSize: resolveMaxFileSize(args),
    maxFilesScanned: args.maxFilesScanned,
    timeoutMs: args.timeoutMs,
    skipBinary: args.skipBinary,
    includeHidden,
    wholeWord: args.wholeWord,
    baseNameMatch: args.baseNameMatch,
    caseSensitiveFileMatch: args.caseSensitiveFileMatch,
  };
  if (signal) return { ...options, signal };
  return options;
}

async function handleSearchContent(
  args: z.infer<typeof SearchContentInputSchema>,
  signal?: AbortSignal
): Promise<ToolResponse<z.infer<typeof SearchContentOutputSchema>>> {
  const basePath = resolvePathOrRoot(args.path);
  const result = await searchContent(
    basePath,
    args.pattern,
    buildSearchOptions(args, signal)
  );
  return buildToolResponse(
    buildSearchTextResult(result),
    buildStructuredSearchResult(result)
  );
}

export function registerSearchContentTool(server: McpServer): void {
  server.registerTool('grep', SEARCH_CONTENT_TOOL, (args, extra) =>
    withToolDiagnostics(
      'grep',
      () =>
        withToolErrorHandling(
          async () => {
            const { signal, cleanup } = createTimedAbortSignal(
              extra.signal,
              args.timeoutMs
            );
            try {
              return await handleSearchContent(args, signal);
            } finally {
              cleanup();
            }
          },
          (error) =>
            buildToolErrorResponse(error, ErrorCode.E_UNKNOWN, args.path ?? '.')
        ),
      { path: args.path ?? '.' }
    )
  );
}

export function registerAllTools(server: McpServer): void {
  registerListAllowedDirectoriesTool(server);
  registerListDirectoryTool(server);
  registerSearchFilesTool(server);
  registerReadFileTool(server);
  registerReadMultipleFilesTool(server);
  registerGetFileInfoTool(server);
  registerGetMultipleFileInfoTool(server);
  registerSearchContentTool(server);
}
