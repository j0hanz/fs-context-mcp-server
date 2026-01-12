import { availableParallelism } from 'node:os';

// Helper for parsing environment variables (only used for configurable values)
function parseEnvInt(
  envVar: string,
  defaultValue: number,
  min: number,
  max: number
): number {
  const value = process.env[envVar];
  if (!value) return defaultValue;

  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) {
    console.error(
      `[WARNING] Invalid ${envVar} value: ${value} (must be ${String(min)}-${String(max)}). Using default: ${String(defaultValue)}`
    );
    return defaultValue;
  }
  return parsed;
}

// Auto-tuned parallelism based on CPU cores (no env override)
function getOptimalParallelism(): number {
  const cpuCores = availableParallelism();
  return Math.min(Math.max(cpuCores, 4), 32);
}

// Hardcoded optimal values (no env override needed)
export const PARALLEL_CONCURRENCY = getOptimalParallelism();

// Configurable via environment variables
export const MAX_SEARCHABLE_FILE_SIZE = parseEnvInt(
  'MAX_SEARCH_SIZE',
  1024 * 1024,
  100 * 1024,
  10 * 1024 * 1024
);
export const MAX_TEXT_FILE_SIZE = parseEnvInt(
  'MAX_FILE_SIZE',
  10 * 1024 * 1024,
  1024 * 1024,
  100 * 1024 * 1024
);
export const DEFAULT_SEARCH_TIMEOUT_MS = parseEnvInt(
  'DEFAULT_SEARCH_TIMEOUT',
  30000,
  100,
  3600000
);

/**
 * Number of search worker threads to use.
 * Default: CPU cores (capped at 8 for optimal I/O performance).
 * Configurable via FS_CONTEXT_SEARCH_WORKERS env var.
 */
export const SEARCH_WORKERS = parseEnvInt(
  'FS_CONTEXT_SEARCH_WORKERS',
  Math.min(availableParallelism(), 8),
  0,
  16
);

// Hardcoded defaults
export const DEFAULT_MAX_DEPTH = 10;
export const DEFAULT_LIST_MAX_ENTRIES = 10000;
export const DEFAULT_SEARCH_MAX_FILES = 20000;

// Non-configurable constants
export const MAX_LINE_CONTENT_LENGTH = 200;
export const BINARY_CHECK_BUFFER_SIZE = 512;

export const KNOWN_BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.mp3',
  '.wav',
  '.flac',
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.webm',
  '.zip',
  '.tar',
  '.gz',
  '.7z',
  '.rar',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.sqlite',
  '.db',
  '.wasm',
  '.bin',
  '.dat',
]);

export const DEFAULT_EXCLUDE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.git/**',
  '**/.vscode/**',
  '**/.idea/**',
  '**/.DS_Store',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.output/**',
  '**/.svelte-kit/**',
  '**/.cache/**',
  '**/.yarn/**',
  '**/jspm_packages/**',
  '**/bower_components/**',
  '**/out/**',
  '**/tmp/**',
  '**/.temp/**',
  '**/npm-debug.log',
  '**/yarn-debug.log',
  '**/yarn-error.log',
  '**/Thumbs.db',
];

const MIME_TYPES = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.bmp', 'image/bmp'],
  ['.tiff', 'image/tiff'],
  ['.tif', 'image/tiff'],
  ['.avif', 'image/avif'],
  ['.heic', 'image/heic'],
  ['.heif', 'image/heif'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.ogg', 'audio/ogg'],
  ['.flac', 'audio/flac'],
  ['.aac', 'audio/aac'],
  ['.m4a', 'audio/mp4'],
  ['.wma', 'audio/x-ms-wma'],
  ['.opus', 'audio/opus'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.avi', 'video/x-msvideo'],
  ['.mov', 'video/quicktime'],
  ['.wmv', 'video/x-ms-wmv'],
  ['.mkv', 'video/x-matroska'],
  ['.flv', 'video/x-flv'],
  ['.pdf', 'application/pdf'],
  ['.txt', 'text/plain'],
  ['.log', 'text/plain'],
  ['.md', 'text/markdown'],
  ['.markdown', 'text/markdown'],
  ['.json', 'application/json'],
  ['.jsonc', 'application/json'],
  ['.xml', 'application/xml'],
  ['.yaml', 'text/yaml'],
  ['.yml', 'text/yaml'],
  ['.html', 'text/html'],
  ['.htm', 'text/html'],
  ['.css', 'text/css'],
  ['.js', 'text/javascript'],
  ['.mjs', 'text/javascript'],
  ['.cjs', 'text/javascript'],
  ['.ts', 'text/typescript'],
  ['.tsx', 'text/typescript'],
  ['.zip', 'application/zip'],
  ['.tar', 'application/x-tar'],
  ['.gz', 'application/gzip'],
  ['.7z', 'application/x-7z-compressed'],
  ['.rar', 'application/vnd.rar'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.wasm', 'application/wasm'],
]);

export function getMimeType(ext: string): string {
  const lowerExt = ext.toLowerCase();
  return MIME_TYPES.get(lowerExt) ?? 'application/octet-stream';
}
