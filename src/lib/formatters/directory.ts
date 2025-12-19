import type { DirectoryEntry } from '../../config/types.js';
import { formatBytes } from './bytes.js';

function splitEntries(entries: DirectoryEntry[]): {
  dirs: DirectoryEntry[];
  files: DirectoryEntry[];
} {
  return {
    dirs: entries.filter((e) => e.type === 'directory'),
    files: entries.filter((e) => e.type !== 'directory'),
  };
}

function formatDirectoryLines(dirs: DirectoryEntry[]): string[] {
  if (dirs.length === 0) return [];
  const lines = ['Directories:'];
  for (const dir of dirs) {
    const symlinkSuffix = dir.symlinkTarget ? ` -> ${dir.symlinkTarget}` : '';
    lines.push(`  [DIR]  ${dir.relativePath}${symlinkSuffix}`);
  }
  lines.push('');
  return lines;
}

function formatFileLine(file: DirectoryEntry): string {
  const size = file.size !== undefined ? formatBytes(file.size) : undefined;
  const sizeSuffix = size !== undefined ? ` (${size})` : '';
  const typeTag = file.type === 'symlink' ? '[LINK]' : '[FILE]';
  const symlinkSuffix = file.symlinkTarget ? ` -> ${file.symlinkTarget}` : '';
  return `  ${typeTag} ${file.relativePath}${sizeSuffix}${symlinkSuffix}`;
}

function formatFileLines(files: DirectoryEntry[]): string[] {
  if (files.length === 0) return [];
  const lines = ['Files:'];
  for (const file of files) {
    lines.push(formatFileLine(file));
  }
  return lines;
}

export function formatDirectoryListing(
  entries: DirectoryEntry[],
  basePath: string
): string {
  if (entries.length === 0) return 'Directory is empty';

  const { dirs, files } = splitEntries(entries);
  const lines = [
    `Contents of ${basePath}:`,
    '',
    ...formatDirectoryLines(dirs),
    ...formatFileLines(files),
    '',
    `Total: ${dirs.length} directories, ${files.length} files`,
  ];

  return lines.join('\n');
}
