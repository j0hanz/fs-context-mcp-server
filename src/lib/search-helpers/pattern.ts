export function isSimpleSafePattern(pattern: string): boolean {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    return false;
  }

  const nestedQuantifierPattern = /[+*?}]\s*\)\s*[+*?{]/;
  if (nestedQuantifierPattern.test(pattern)) {
    return false;
  }

  const highRepetitionPattern = /\{(\d+)(?:,\d*)?\}/g;
  let match;
  while ((match = highRepetitionPattern.exec(pattern)) !== null) {
    const countStr = match[1];
    if (countStr === undefined) continue;

    const count = parseInt(countStr, 10);
    if (Number.isNaN(count) || count >= 25) {
      return false;
    }
  }

  return true;
}

export function prepareSearchPattern(
  searchPattern: string,
  options: { isLiteral?: boolean; wholeWord?: boolean }
): string {
  let finalPattern = searchPattern;

  if (options.isLiteral) {
    finalPattern = finalPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  if (options.wholeWord) {
    finalPattern = `\\b${finalPattern}\\b`;
  }

  return finalPattern;
}
