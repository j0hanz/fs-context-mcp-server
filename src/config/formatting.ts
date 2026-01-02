const BYTE_UNIT_LABELS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const unitIndex = Math.floor(Math.log(bytes) / Math.log(1024));
  const unit = BYTE_UNIT_LABELS[unitIndex] ?? 'B';
  const value = bytes / Math.pow(1024, unitIndex);
  return `${parseFloat(value.toFixed(2))} ${unit}`;
}

export function formatDate(date: Date): string {
  return date.toISOString();
}

export function joinLines(lines: readonly string[]): string {
  return lines.join('\n');
}

export function formatOperationSummary(summary: {
  truncated?: boolean;
  truncatedReason?: string;
  tip?: string;
  skippedInaccessible?: number;
  symlinksNotFollowed?: number;
  skippedTooLarge?: number;
  skippedBinary?: number;
  linesSkippedDueToRegexTimeout?: number;
}): string {
  const notes: string[] = [];
  if (summary.truncated) {
    notes.push(`[truncated: ${summary.truncatedReason ?? 'limit reached'}]`);
    if (summary.tip) notes.push(`[tip: ${summary.tip}]`);
  }
  const addNote = (count: number | undefined, label: string): void => {
    if (count && count > 0) notes.push(`[${count} ${label}]`);
  };
  addNote(summary.skippedTooLarge, 'skipped: too large');
  addNote(summary.skippedBinary, 'skipped: binary');
  addNote(summary.skippedInaccessible, 'skipped: inaccessible');
  addNote(summary.symlinksNotFollowed, 'symlinks not followed');
  addNote(
    summary.linesSkippedDueToRegexTimeout,
    'lines skipped: regex timeout'
  );
  return notes.length > 0 ? `\n${notes.join(' ')}` : '';
}
