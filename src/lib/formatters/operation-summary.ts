export interface OperationSummary {
  truncated?: boolean;
  truncatedReason?: string;
  tip?: string;
  skippedInaccessible?: number;
  symlinksNotFollowed?: number;
  skippedTooLarge?: number;
  skippedBinary?: number;
  linesSkippedDueToRegexTimeout?: number;
}

function appendNote(
  lines: string[],
  count: number | undefined,
  message: string
): void {
  if (!count || count <= 0) return;
  lines.push(`Note: ${count} ${message}`);
}

function appendTruncation(lines: string[], summary: OperationSummary): void {
  if (!summary.truncated) return;
  lines.push(
    `\n\n!! PARTIAL RESULTS: ${summary.truncatedReason ?? 'results truncated'}`
  );
  if (summary.tip) {
    lines.push(`Tip: ${summary.tip}`);
  }
}

export function formatOperationSummary(summary: OperationSummary): string {
  const lines: string[] = [];

  appendTruncation(lines, summary);
  appendNote(lines, summary.skippedTooLarge, 'file(s) skipped (too large).');
  appendNote(lines, summary.skippedBinary, 'file(s) skipped (binary).');
  appendNote(
    lines,
    summary.skippedInaccessible,
    'item(s) were inaccessible and skipped.'
  );
  appendNote(
    lines,
    summary.symlinksNotFollowed,
    'symlink(s) were not followed (security).'
  );
  appendNote(
    lines,
    summary.linesSkippedDueToRegexTimeout,
    'line(s) skipped (regex timeout).'
  );

  return lines.join('\n');
}
