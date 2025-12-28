import { ErrorCode, McpError } from './errors.js';

export type LineRangeField = 'lineStart' | 'lineEnd';

export interface LineRangeIssues {
  missingPair?: { missing: LineRangeField; provided: LineRangeField };
  invalidOrder?: { start: number; end: number };
  multipleModes?: boolean;
}

export interface LineRangeOptions {
  lineStart?: number;
  lineEnd?: number;
  head?: number;
  tail?: number;
}

function getMissingPair(
  hasLineStart: boolean,
  hasLineEnd: boolean
): LineRangeIssues['missingPair'] | undefined {
  if (hasLineStart === hasLineEnd) return undefined;
  return {
    missing: hasLineStart ? 'lineEnd' : 'lineStart',
    provided: hasLineStart ? 'lineStart' : 'lineEnd',
  };
}

function getInvalidOrder(
  lineStart: number | undefined,
  lineEnd: number | undefined
): LineRangeIssues['invalidOrder'] | undefined {
  if (lineStart === undefined || lineEnd === undefined) return undefined;
  if (lineEnd >= lineStart) return undefined;
  return { start: lineStart, end: lineEnd };
}

function hasMultipleModes(
  hasLineRange: boolean,
  hasHead: boolean,
  hasTail: boolean
): boolean {
  const modes = Number(hasLineRange) + Number(hasHead) + Number(hasTail);
  return modes > 1;
}

export function validateLineRange(options: LineRangeOptions): LineRangeIssues {
  const { lineStart, lineEnd, head, tail } = options;
  const hasLineStart = lineStart !== undefined;
  const hasLineEnd = lineEnd !== undefined;
  const hasLineRange = hasLineStart || hasLineEnd;
  const hasHead = head !== undefined;
  const hasTail = tail !== undefined;

  const issues: LineRangeIssues = {};

  const missingPair = getMissingPair(hasLineStart, hasLineEnd);
  if (missingPair) {
    issues.missingPair = missingPair;
  }

  const invalidOrder = getInvalidOrder(lineStart, lineEnd);
  if (invalidOrder) {
    issues.invalidOrder = invalidOrder;
  }

  if (hasMultipleModes(hasLineRange, hasHead, hasTail)) {
    issues.multipleModes = true;
  }

  return issues;
}

export function buildLineRange(
  lineStart: number | undefined,
  lineEnd: number | undefined
): { start: number; end: number } | undefined {
  if (lineStart === undefined || lineEnd === undefined) return undefined;
  return { start: lineStart, end: lineEnd };
}

export function assertLineRangeOptions(
  options: LineRangeOptions,
  pathLabel: string
): void {
  const issues = validateLineRange(options);
  if (issues.missingPair) {
    throw new McpError(
      ErrorCode.E_INVALID_INPUT,
      `Invalid lineRange: ${issues.missingPair.provided} requires ${issues.missingPair.missing} to also be specified`,
      pathLabel
    );
  }

  if (issues.invalidOrder) {
    throw new McpError(
      ErrorCode.E_INVALID_INPUT,
      `Invalid lineRange: lineEnd (${issues.invalidOrder.end}) must be >= lineStart (${issues.invalidOrder.start})`,
      pathLabel
    );
  }

  if (issues.multipleModes) {
    throw new McpError(
      ErrorCode.E_INVALID_INPUT,
      'Cannot specify multiple of lineRange (lineStart + lineEnd), head, or tail simultaneously',
      pathLabel
    );
  }
}
