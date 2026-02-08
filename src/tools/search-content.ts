import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { z } from 'zod';

import { formatOperationSummary, joinLines } from '../config.js';
import { ErrorCode } from '../lib/errors.js';
import { searchContent } from '../lib/file-operations/search-content.js';
import type { SearchContentOptions } from '../lib/file-operations/search-content.js';
import { withToolDiagnostics } from '../lib/observability.js';
import {
  SearchContentInputSchema,
  SearchContentOutputSchema,
} from '../schemas.js';
import {
  buildResourceLink,
  buildToolErrorResponse,
  buildToolResponse,
  createProgressReporter,
  resolvePathOrRoot,
  type ToolExtra,
  type ToolRegistrationOptions,
  type ToolResponse,
  type ToolResult,
  withToolErrorHandling,
  wrapToolHandler,
} from './shared.js';

const MAX_INLINE_MATCHES = 50;

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
    lines.push(formatSearchMatchLine(match));
  }

  return joinLines(lines) + formatOperationSummary(summaryOptions);
}

type SearchMatchPayload = NonNullable<
  z.infer<typeof SearchContentOutputSchema>['matches']
>[number];

function buildSearchMatchPayload(
  match: NormalizedSearchMatch
): SearchMatchPayload {
  return {
    file: match.relativeFile,
    line: match.line,
    content: match.content,
    matchCount: match.matchCount,
    ...(match.contextBefore ? { contextBefore: [...match.contextBefore] } : {}),
    ...(match.contextAfter ? { contextAfter: [...match.contextAfter] } : {}),
  };
}

function formatSearchMatchLine(match: NormalizedSearchMatch): string {
  const lineNum = String(match.line).padStart(4);
  return `  ${match.relativeFile}:${lineNum}: ${match.content}`;
}

function buildStructuredSearchResult(
  result: Awaited<ReturnType<typeof searchContent>>,
  normalizedMatches: NormalizedSearchMatch[]
): z.infer<typeof SearchContentOutputSchema> {
  return {
    ok: true,
    matches: normalizedMatches.map(buildSearchMatchPayload),
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

async function handleSearchContent(
  args: z.infer<typeof SearchContentInputSchema>,
  signal?: AbortSignal,
  resourceStore?: ToolRegistrationOptions['resourceStore'],
  onProgress?: (progress: { total?: number; current: number }) => void
): Promise<ToolResponse<z.infer<typeof SearchContentOutputSchema>>> {
  const basePath = resolvePathOrRoot(args.path);
  const options: SearchContentOptions = {
    includeHidden: args.includeHidden,
    isLiteral: !args.isRegex,
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
    matches: previewMatches.map(buildSearchMatchPayload),
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
    ...previewMatches.map(formatSearchMatchLine),
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

export function registerSearchContentTool(
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
    {
      ...SEARCH_CONTENT_TOOL,
      ...(options.iconInfo
        ? {
            icons: [
              {
                src: options.iconInfo.src,
                mimeType: options.iconInfo.mimeType,
                ...(options.iconInfo.mimeType === 'image/svg+xml'
                  ? { sizes: ['any'] }
                  : {}),
              },
            ],
          }
        : {}),
    },
    wrapToolHandler(handler, {
      guard: options.isInitialized,
      progressMessage: (args) => `grep ${args.pattern}`,
    })
  );
}
