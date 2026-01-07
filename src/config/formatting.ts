const BYTE_UNIT_LABELS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const unitIndex = Math.floor(Math.log(bytes) / Math.log(1024));
  const unit = BYTE_UNIT_LABELS[unitIndex] ?? 'B';
  const value = bytes / Math.pow(1024, unitIndex);
  return `${parseFloat(value.toFixed(2))} ${unit}`;
}

export function joinLines(lines: readonly string[]): string {
  return lines.join('\n');
}

export function formatOperationSummary(summary: {
  truncated?: boolean;
  truncatedReason?: string;
}): string {
  if (!summary.truncated) return '';
  return `\n[truncated: ${summary.truncatedReason ?? 'limit reached'}]`;
}
