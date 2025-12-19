import safeRegex from 'safe-regex2';

import { ErrorCode, McpError } from '../errors.js';
import {
  isSimpleSafePattern,
  prepareSearchPattern,
} from '../search-helpers.js';

interface SearchRegexOptions {
  isLiteral: boolean;
  wholeWord: boolean;
  caseSensitive: boolean;
  basePath: string;
}

function ensureSafePattern(
  finalPattern: string,
  searchPattern: string,
  basePath: string,
  needsReDoSCheck: boolean
): void {
  if (!needsReDoSCheck || safeRegex(finalPattern)) return;

  throw new McpError(
    ErrorCode.E_INVALID_PATTERN,
    `Potentially unsafe regular expression (ReDoS risk): ${searchPattern}. ` +
      'Avoid patterns with nested quantifiers, overlapping alternations, or exponential backtracking.',
    basePath,
    { reason: 'ReDoS risk detected' }
  );
}

function compileRegex(
  finalPattern: string,
  caseSensitive: boolean,
  basePath: string
): RegExp {
  try {
    return new RegExp(finalPattern, caseSensitive ? 'g' : 'gi');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new McpError(
      ErrorCode.E_INVALID_PATTERN,
      `Invalid regular expression: ${finalPattern} (${message})`,
      basePath,
      { searchPattern: finalPattern }
    );
  }
}

export function buildSearchRegex(
  searchPattern: string,
  options: SearchRegexOptions
): { regex: RegExp; finalPattern: string } {
  const { isLiteral, wholeWord, caseSensitive, basePath } = options;

  const finalPattern = prepareSearchPattern(searchPattern, {
    isLiteral,
    wholeWord,
  });

  const needsReDoSCheck = !isLiteral && !isSimpleSafePattern(finalPattern);
  ensureSafePattern(finalPattern, searchPattern, basePath, needsReDoSCheck);

  return {
    regex: compileRegex(finalPattern, caseSensitive, basePath),
    finalPattern,
  };
}
