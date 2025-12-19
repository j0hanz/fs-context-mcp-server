import type { DirectoryAnalysis } from '../../config/types.js';
import { formatBytes } from './bytes.js';
import { formatDate } from './date.js';

const ANALYSIS_SEPARATOR_WIDTH = 50;

function formatSummary(analysis: DirectoryAnalysis): string[] {
  return [
    `Directory Analysis: ${analysis.path}`,
    '='.repeat(ANALYSIS_SEPARATOR_WIDTH),
    '',
    'Summary:',
    `  Total Files: ${analysis.totalFiles}`,
    `  Total Directories: ${analysis.totalDirectories}`,
    `  Total Size: ${formatBytes(analysis.totalSize)}`,
    `  Max Depth: ${analysis.maxDepth}`,
    '',
  ];
}

function formatFileTypesSection(analysis: DirectoryAnalysis): string[] {
  const entries = Object.entries(analysis.fileTypes);
  if (entries.length === 0) return [];

  const sorted = entries.sort((a, b) => b[1] - a[1]);
  const lines = ['File Types:'];
  for (const [ext, count] of sorted) {
    lines.push(`  ${ext}: ${count}`);
  }
  lines.push('');
  return lines;
}

function formatLargestFilesSection(analysis: DirectoryAnalysis): string[] {
  if (analysis.largestFiles.length === 0) return [];
  const lines = ['Largest Files:'];
  for (const file of analysis.largestFiles) {
    lines.push(`  ${formatBytes(file.size)} - ${file.path}`);
  }
  lines.push('');
  return lines;
}

function formatRecentlyModifiedSection(analysis: DirectoryAnalysis): string[] {
  if (analysis.recentlyModified.length === 0) return [];
  const lines = ['Recently Modified:'];
  for (const file of analysis.recentlyModified) {
    lines.push(`  ${formatDate(file.modified)} - ${file.path}`);
  }
  return lines;
}

export function formatDirectoryAnalysis(analysis: DirectoryAnalysis): string {
  const lines = [
    ...formatSummary(analysis),
    ...formatFileTypesSection(analysis),
    ...formatLargestFilesSection(analysis),
    ...formatRecentlyModifiedSection(analysis),
  ];
  return lines.join('\n');
}
