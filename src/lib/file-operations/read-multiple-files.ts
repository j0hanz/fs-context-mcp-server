import * as fs from 'node:fs/promises';

import { MAX_TEXT_FILE_SIZE, PARALLEL_CONCURRENCY } from '../constants.js';
import { ErrorCode, McpError } from '../errors.js';
import { processInParallel, readFile } from '../fs-helpers.js';
import { validateExistingPath } from '../path-validation.js';

interface ReadMultipleResult {
  path: string;
  content?: string;
  truncated?: boolean;
  totalLines?: number;
  error?: string;
}

function assertHeadTailOptions(
  head: number | undefined,
  tail: number | undefined
): void {
  if (head === undefined || tail === undefined) return;

  throw new McpError(
    ErrorCode.E_INVALID_INPUT,
    'Cannot specify both head and tail simultaneously',
    undefined
  );
}

function createOutputSkeleton(filePaths: string[]): ReadMultipleResult[] {
  return filePaths.map((filePath) => ({ path: filePath }));
}

async function collectFileBudget(
  filePaths: string[],
  isPartialRead: boolean,
  maxTotalSize: number
): Promise<{ skippedBudget: Set<string> }> {
  const skippedBudget = new Set<string>();
  let totalSize = 0;

  for (const filePath of filePaths) {
    try {
      const validPath = await validateExistingPath(filePath);
      const stats = await fs.stat(validPath);

      if (!isPartialRead) {
        if (totalSize + stats.size > maxTotalSize) {
          skippedBudget.add(filePath);
          continue;
        }
        totalSize += stats.size;
      }
    } catch {
      // Ignore per-file size errors; handled during read.
    }
  }

  return { skippedBudget };
}

function buildProcessTargets(
  filePaths: string[],
  skippedBudget: Set<string>
): { filePath: string; index: number }[] {
  return filePaths
    .map((filePath, index) => ({ filePath, index }))
    .filter(({ filePath }) => !skippedBudget.has(filePath));
}

function applyParallelResults(
  output: ReadMultipleResult[],
  results: { index: number; value: ReadMultipleResult }[],
  errors: { index: number; error: Error }[],
  filePaths: string[]
): void {
  for (const result of results) {
    output[result.index] = result.value;
  }

  for (const failure of errors) {
    const filePath = filePaths[failure.index] ?? '(unknown)';
    output[failure.index] = {
      path: filePath,
      error: failure.error.message,
    };
  }
}

function applySkippedBudgetErrors(
  output: ReadMultipleResult[],
  skippedBudget: Set<string>,
  filePaths: string[],
  maxTotalSize: number
): void {
  for (const filePath of skippedBudget) {
    const index = filePaths.indexOf(filePath);
    if (index === -1) continue;

    output[index] = {
      path: filePath,
      error: `Skipped: combined total would exceed maxTotalSize (${maxTotalSize} bytes)`,
    };
  }
}

export async function readMultipleFiles(
  filePaths: string[],
  options: {
    encoding?: BufferEncoding;
    maxSize?: number;
    maxTotalSize?: number;
    head?: number;
    tail?: number;
  } = {}
): Promise<ReadMultipleResult[]> {
  if (filePaths.length === 0) return [];

  const {
    encoding = 'utf-8',
    maxSize = MAX_TEXT_FILE_SIZE,
    maxTotalSize = 100 * 1024 * 1024,
    head,
    tail,
  } = options;

  assertHeadTailOptions(head, tail);

  const output = createOutputSkeleton(filePaths);
  const isPartialRead = head !== undefined || tail !== undefined;
  const { skippedBudget } = await collectFileBudget(
    filePaths,
    isPartialRead,
    maxTotalSize
  );

  const filesToProcess = buildProcessTargets(filePaths, skippedBudget);

  const { results, errors } = await processInParallel(
    filesToProcess,
    async ({ filePath, index }) => {
      const result = await readFile(filePath, {
        encoding,
        maxSize,
        head,
        tail,
      });

      return {
        index,
        value: {
          path: result.path,
          content: result.content,
          truncated: result.truncated,
          totalLines: result.totalLines,
        },
      };
    },
    PARALLEL_CONCURRENCY
  );

  applyParallelResults(output, results, errors, filePaths);
  applySkippedBudgetErrors(output, skippedBudget, filePaths, maxTotalSize);

  return output;
}
