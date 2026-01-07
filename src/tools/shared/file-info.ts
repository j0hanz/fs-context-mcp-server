import { formatBytes, joinLines } from '../../config/formatting.js';
import type { FileInfo } from '../../config/types.js';

export function buildFileInfoPayload(info: FileInfo): {
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
} {
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
    mimeType: info.mimeType,
    symlinkTarget: info.symlinkTarget,
  };
}

export function formatFileInfoDetails(info: FileInfo): string {
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

export function formatFileInfoSummary(path: string, info: FileInfo): string {
  return `${path} (${info.type}, ${formatBytes(info.size)})`;
}
