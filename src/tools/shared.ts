import { inspect } from 'node:util';

import type {
  ContentBlock,
  Icon,
  ProgressNotificationParams,
} from '@modelcontextprotocol/sdk/types.js';

import type { z } from 'zod';

import {
  createDetailedError,
  ErrorCode,
  formatDetailedError,
  getSuggestion,
  McpError,
} from '../lib/errors.js';
import { getAllowedDirectories } from '../lib/path-validation.js';
import type { ResourceStore } from '../lib/resource-store.js';
import type { ToolErrorResponseSchema } from '../schemas.js';

const MAX_INLINE_CONTENT_CHARS = 20_000;
const MAX_INLINE_PREVIEW_CHARS = 4_000;

type ResourceEntry = ReturnType<ResourceStore['putText']>;

function buildTextPreview(text: string): string {
  if (text.length <= MAX_INLINE_PREVIEW_CHARS) return text;
  return `${text.slice(0, MAX_INLINE_PREVIEW_CHARS)}\n… [truncated preview]`;
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
  extraContent: ContentBlock[] = [],
  resourceStore?: ResourceStore
): { content: ContentBlock[]; structuredContent: T } {
  let json: string;
  try {
    json = JSON.stringify(structuredContent);
  } catch (error: unknown) {
    const preview = inspect(structuredContent, {
      depth: 4,
      colors: false,
      compact: 3,
      breakLength: 80,
    });
    const errorMessage = error instanceof Error ? error.message : String(error);
    json = JSON.stringify({
      ok: false,
      error: `Failed to serialize structuredContent: ${errorMessage}`,
      preview,
    });
  }

  const externalized = maybeExternalizeTextContent(resourceStore, json, {
    name: 'tool:structuredContent',
    mimeType: 'application/json',
  });

  const jsonContent: ContentBlock[] = externalized
    ? [
        { type: 'text', text: externalized.preview },
        buildResourceLink({
          uri: externalized.entry.uri,
          name: externalized.entry.name,
          mimeType: externalized.entry.mimeType,
          description: 'Full structuredContent JSON',
        }),
      ]
    : [{ type: 'text', text: json }];

  return {
    content: [{ type: 'text', text }, ...extraContent, ...jsonContent],
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
  extraContent: ContentBlock[] = [],
  resourceStore?: ResourceStore
): {
  content: ContentBlock[];
  structuredContent: T;
} {
  return buildContentBlock(
    text,
    structuredContent,
    extraContent,
    resourceStore
  );
}

export type ToolResponse<T> = ReturnType<typeof buildToolResponse<T>> &
  Record<string, unknown>;

type ToolErrorStructuredContent = z.infer<typeof ToolErrorResponseSchema>;

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

function canSendProgress(extra: ToolExtra): extra is ToolExtra & {
  _meta: { progressToken: ProgressToken };
  sendNotification: NonNullable<ToolExtra['sendNotification']>;
} {
  return (
    extra._meta?.progressToken !== undefined &&
    extra.sendNotification !== undefined
  );
}

export interface IconInfo {
  src: string;
  mimeType: string;
}

export function withDefaultIcons<T extends object>(
  tool: T,
  iconInfo: IconInfo | undefined
): T & { icons?: Icon[] } {
  if (!iconInfo) return tool as T & { icons?: Icon[] };

  const existingIcons = (tool as { icons?: Icon[] }).icons;
  if (existingIcons && existingIcons.length > 0) {
    return tool as T & { icons?: Icon[] };
  }

  return {
    ...tool,
    icons: [
      {
        src: iconInfo.src,
        mimeType: iconInfo.mimeType,
      },
    ],
  } as unknown as T & { icons?: Icon[] };
}

export interface ToolRegistrationOptions {
  resourceStore?: ResourceStore;
  isInitialized?: () => boolean;
  serverIcon?: string;
  iconInfo?: IconInfo;
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
  if (!canSendProgress(extra)) return;
  try {
    await extra.sendNotification({
      method: 'notifications/progress',
      params,
    });
  } catch {
    // Ignore progress notification failures to avoid breaking tool execution.
  }
}

export function createProgressReporter(
  extra: ToolExtra
): (progress: { total?: number; current: number }) => void {
  if (!canSendProgress(extra)) {
    return () => {};
  }
  const token = extra._meta.progressToken;
  return (progress) => {
    const { current, total } = progress;
    void sendProgressNotification(extra, {
      progressToken: token,
      total,
      progress: current,
    });
  };
}

export function notifyProgress(
  extra: ToolExtra,
  progress: { current: number; total?: number; message?: string }
): void {
  if (!canSendProgress(extra)) return;
  const token = extra._meta.progressToken;
  void sendProgressNotification(extra, {
    progressToken: token,
    progress: progress.current,
    ...(progress.total !== undefined ? { total: progress.total } : {}),
    ...(progress.message !== undefined ? { message: progress.message } : {}),
  });
}

async function withProgress<T>(
  message: string,
  extra: ToolExtra,
  run: () => Promise<T>,
  getCompletionMessage?: (result: T) => string | undefined
): Promise<T> {
  if (!canSendProgress(extra)) {
    return await run();
  }
  const token = extra._meta.progressToken;

  const total = 1;
  await sendProgressNotification(extra, {
    progressToken: token,
    progress: 0,
    total,
    message,
  });

  try {
    const result = await run();
    const endMessage = getCompletionMessage?.(result) ?? message;
    await sendProgressNotification(extra, {
      progressToken: token,
      progress: total,
      total,
      message: endMessage,
    });
    return result;
  } catch (error) {
    await sendProgressNotification(extra, {
      progressToken: token,
      progress: total,
      total,
      message,
    });
    throw error;
  }
}

export function wrapToolHandler<Args, Result>(
  handler: (args: Args, extra: ToolExtra) => Promise<ToolResult<Result>>,
  options: {
    guard?: (() => boolean) | undefined;
    progressMessage?: (args: Args) => string;
    completionMessage?: (
      args: Args,
      result: ToolResult<Result>
    ) => string | undefined;
  }
): (args: Args, extra?: ToolExtra) => Promise<ToolResult<Result>> {
  return async (args: Args, extra?: ToolExtra) => {
    const resolvedExtra = extra ?? {};
    if (options.guard && !options.guard()) {
      return buildNotInitializedResult();
    }

    if (options.progressMessage) {
      const message = options.progressMessage(args);
      const { completionMessage } = options;
      const completionFn = completionMessage
        ? (result: ToolResult<Result>) => completionMessage(args, result)
        : undefined;
      return await withProgress(
        message,
        resolvedExtra,
        () => handler(args, resolvedExtra),
        completionFn
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
