import { hash, randomUUID } from 'node:crypto';

import { ErrorCode, McpError } from './errors.js';

export interface TextResourceEntry {
  uri: string;
  name: string;
  mimeType: string;
  text: string;
  hash: string;
}

export interface ResourceStore {
  putText(params: {
    name: string;
    mimeType?: string;
    text: string;
  }): TextResourceEntry;
  getText(uri: string): TextResourceEntry;
  clear(): void;
}

interface ResourceStoreOptions {
  maxEntries: number;
  maxTotalBytes: number;
  maxEntryBytes: number;
}

const DEFAULT_RESOURCE_STORE_OPTIONS: ResourceStoreOptions = {
  maxEntries: 64,
  maxTotalBytes: 25 * 1024 * 1024,
  maxEntryBytes: 10 * 1024 * 1024,
};

function estimateBytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function computeSha256(text: string): string {
  return hash('sha256', text, 'hex');
}

export function createInMemoryResourceStore(
  options: Partial<ResourceStoreOptions> = {}
): ResourceStore {
  const resolved: ResourceStoreOptions = {
    ...DEFAULT_RESOURCE_STORE_OPTIONS,
    ...options,
  };

  const byUri = new Map<string, TextResourceEntry>();
  let totalBytes = 0;

  function evictOldest(): void {
    const first = byUri.keys().next();
    if (first.done) return;
    const uri = first.value;
    const existing = byUri.get(uri);
    if (!existing) return;
    totalBytes -= estimateBytes(existing.text);
    byUri.delete(uri);
  }

  function enforceLimits(): void {
    while (byUri.size > resolved.maxEntries) evictOldest();
    while (totalBytes > resolved.maxTotalBytes) {
      if (byUri.size === 0) break;
      evictOldest();
    }
  }

  function putText(params: {
    name: string;
    mimeType?: string;
    text: string;
  }): TextResourceEntry {
    const mimeType = params.mimeType ?? 'text/plain';
    const entryBytes = estimateBytes(params.text);
    if (entryBytes > resolved.maxEntryBytes) {
      throw new McpError(
        ErrorCode.E_TOO_LARGE,
        `Resource too large to cache (${entryBytes} bytes)`
      );
    }

    const id = randomUUID();
    const uri = `filesystem-mcp://result/${id}`;
    const hash = computeSha256(params.text);

    const entry: TextResourceEntry = {
      uri,
      name: params.name,
      mimeType,
      text: params.text,
      hash,
    };

    byUri.set(uri, entry);
    totalBytes += entryBytes;

    enforceLimits();

    if (!byUri.has(uri)) {
      throw new McpError(
        ErrorCode.E_TOO_LARGE,
        'Resource cache full: entry evicted immediately'
      );
    }

    return entry;
  }

  function getText(uri: string): TextResourceEntry {
    const existing = byUri.get(uri);
    if (!existing) {
      throw new McpError(ErrorCode.E_NOT_FOUND, `Resource not found: ${uri}`);
    }
    return existing;
  }

  function clear(): void {
    byUri.clear();
    totalBytes = 0;
  }

  return { putText, getText, clear };
}
