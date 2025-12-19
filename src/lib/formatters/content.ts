import type { ContentMatch } from '../../config/types.js';

const LINE_NUMBER_PAD_WIDTH = 4;

function groupMatchesByFile(
  matches: ContentMatch[]
): Map<string, ContentMatch[]> {
  const byFile = new Map<string, ContentMatch[]>();
  for (const match of matches) {
    const existing = byFile.get(match.file);
    if (existing) {
      existing.push(match);
    } else {
      byFile.set(match.file, [match]);
    }
  }
  return byFile;
}

function formatContextLines(
  context: string[] | undefined,
  startLine: number
): string[] {
  if (!context || context.length === 0) return [];

  return context.map((line, index) => {
    const lineNum = startLine + index;
    return `    ${String(lineNum).padStart(LINE_NUMBER_PAD_WIDTH)}: ${line}`;
  });
}

function formatMatchLines(match: ContentMatch): string[] {
  const beforeLines = formatContextLines(
    match.contextBefore,
    match.line - (match.contextBefore?.length ?? 0)
  );
  const afterLines = formatContextLines(match.contextAfter, match.line + 1);
  const lines: string[] = [
    ...beforeLines,
    `  > ${String(match.line).padStart(LINE_NUMBER_PAD_WIDTH)}: ${match.content}`,
    ...afterLines,
  ];

  if (beforeLines.length > 0 || afterLines.length > 0) {
    lines.push('    ---');
  }

  return lines;
}

export function formatContentMatches(matches: ContentMatch[]): string {
  if (matches.length === 0) return 'No matches found';

  const lines = [`Found ${matches.length} matches:`, ''];
  const byFile = groupMatchesByFile(matches);

  for (const [file, fileMatches] of byFile) {
    lines.push(`${file}:`);
    for (const match of fileMatches) {
      lines.push(...formatMatchLines(match));
    }
    lines.push('');
  }

  return lines.join('\n');
}
