import type {
  ContentBlock,
  ProgressNotificationParams,
} from '@modelcontextprotocol/sdk/types.js';

import {
  createDetailedError,
  ErrorCode,
  formatDetailedError,
  getSuggestion,
  McpError,
} from '../lib/errors.js';
import { getAllowedDirectories } from '../lib/path-validation.js';
import type { ResourceStore } from '../lib/resource-store.js';

const MAX_INLINE_CONTENT_CHARS = 20_000;
const MAX_INLINE_PREVIEW_CHARS = 4_000;

type ResourceEntry = ReturnType<ResourceStore['putText']>;

interface LineRangeArgs {
  head?: number;
  startLine?: number;
  endLine?: number;
}

interface LineRangeArgsInput {
  head?: number | undefined;
  startLine?: number | undefined;
  endLine?: number | undefined;
}

function buildTextPreview(text: string): string {
  if (text.length <= MAX_INLINE_PREVIEW_CHARS) return text;
  return `${text.slice(0, MAX_INLINE_PREVIEW_CHARS)}\n… [truncated preview]`;
}

export function applyLineRangeOptions(
  target: LineRangeArgs,
  source: LineRangeArgsInput
): void {
  if (source.head !== undefined) {
    target.head = source.head;
  }
  if (source.startLine !== undefined) {
    target.startLine = source.startLine;
  }
  if (source.endLine !== undefined) {
    target.endLine = source.endLine;
  }
}

export function maybeExternalizeTextContent(
  resourceStore: ResourceStore | undefined,
  content: string,
  params: { name: string; mimeType?: string }
): { entry: ResourceEntry; preview: string } | undefined {
  if (!resourceStore) return undefined;
  if (content.length <= MAX_INLINE_CONTENT_CHARS) return undefined;

  const entry = resourceStore.putText({
    name: params.name,
    ...(params.mimeType !== undefined ? { mimeType: params.mimeType } : {}),
    text: content,
  });

  return {
    entry,
    preview: buildTextPreview(content),
  };
}

export function buildResourceLink(params: {
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
  content: ContentBlock[];
  structuredContent: ToolErrorStructuredContent;
  isError: true;
}

export type ToolResult<T> = ToolResponse<T> | ToolErrorResponse;

type ProgressToken = string | number;

export interface ToolExtra {
  signal?: AbortSignal;
  _meta?: {
    progressToken?: ProgressToken | undefined;
  };
  sendNotification?: (notification: {
    method: 'notifications/progress';
    params: ProgressNotificationParams;
  }) => Promise<void>;
}

export interface ToolRegistrationOptions {
  resourceStore?: ResourceStore;
  isInitialized?: () => boolean;
}

const NOT_INITIALIZED_ERROR = new McpError(
  ErrorCode.E_INVALID_INPUT,
  'Client not initialized; wait for notifications/initialized'
);

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

export function wrapToolHandler<Args, Result>(
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

export function resolvePathOrRoot(pathValue: string | undefined): string {
  if (pathValue && pathValue.trim().length > 0) return pathValue;
  const roots = getAllowedDirectories();
  if (roots.length === 0) {
    throw new McpError(
      ErrorCode.E_ACCESS_DENIED,
      'No workspace roots configured. Use the roots tool to check, or configure roots via the MCP Roots protocol (or start with --allow-cwd / CLI directories).'
    );
  }
  if (roots.length > 1) {
    throw new McpError(
      ErrorCode.E_INVALID_INPUT,
      'Multiple workspace roots configured. Provide an explicit path to disambiguate.'
    );
  }
  return roots[0] ?? '';
}
