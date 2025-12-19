import { REGEX_MATCH_TIMEOUT_MS } from '../constants.js';

export function countLiteralMatches(
  line: string,
  searchString: string,
  caseSensitive: boolean
): number {
  if (line.length === 0 || searchString.length === 0) return 0;

  const haystack = caseSensitive ? line : line.toLowerCase();
  const needle = caseSensitive ? searchString : searchString.toLowerCase();

  let count = 0;
  let pos = 0;

  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }

  return count;
}

function shouldAbortRegex(
  count: number,
  iterations: number,
  deadline: number,
  maxIterations: number
): boolean {
  const shouldCheckTimeout =
    (count > 0 && count % 10 === 0) ||
    (iterations > 0 && iterations % 50 === 0);
  if (shouldCheckTimeout && Date.now() > deadline) {
    return true;
  }
  return iterations > maxIterations;
}

function advanceRegexMatch(
  regex: RegExp,
  match: RegExpExecArray,
  lineLength: number,
  lastIndex: number
): { status: 'ok' | 'stuck'; lastIndex: number; shouldBreak: boolean } {
  if (match[0] === '') {
    const { lastIndex: newIndex } = regex;
    regex.lastIndex++;
    const nextIndex = newIndex + 1;
    const shouldBreak = regex.lastIndex > lineLength;
    return { status: 'ok', lastIndex: nextIndex, shouldBreak };
  }

  const { lastIndex: currentIndex } = regex;
  if (currentIndex === lastIndex) {
    return { status: 'stuck', lastIndex, shouldBreak: true };
  }
  return { status: 'ok', lastIndex: currentIndex, shouldBreak: false };
}

export function countRegexMatches(
  line: string,
  regex: RegExp,
  timeoutMs: number = REGEX_MATCH_TIMEOUT_MS
): number {
  if (line.length === 0) return 0;

  regex.lastIndex = 0;
  let count = 0;
  const deadline = Date.now() + timeoutMs;
  const maxIterations = Math.min(line.length * 2, 10000);
  let iterations = 0;
  let lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    count++;
    iterations++;

    const {
      status,
      lastIndex: nextIndex,
      shouldBreak,
    } = advanceRegexMatch(regex, match, line.length, lastIndex);
    if (status === 'stuck') {
      return -1;
    }
    lastIndex = nextIndex;
    if (shouldBreak) {
      break;
    }

    if (shouldAbortRegex(count, iterations, deadline, maxIterations)) {
      return -1;
    }
  }

  return count;
}
