import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import fg from 'fast-glob';
import ts from 'typescript';

export interface FunctionMetrics {
  name: string;
  complexity: number;
  length: number;
  maxDepth: number;
}

export interface FileMetrics {
  path: string;
  loc: number;
  functions: FunctionMetrics[];
  avgComplexity: number;
  maxComplexity: number;
  maxFunctionLength: number;
  maxDepth: number;
}

export interface MetricsSummary {
  totalFiles: number;
  totalFunctions: number;
  avgComplexity: number;
  maxComplexity: number;
  avgFunctionLength: number;
  maxFunctionLength: number;
  maxDepth: number;
  avgFileLoc: number;
  maxFileLoc: number;
}

export interface MetricsReport {
  generatedAt: string;
  root: string;
  files: FileMetrics[];
  summary: MetricsSummary;
}

const DEFAULT_PATTERNS = ['**/*.ts', '**/*.tsx'];
const DEFAULT_IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/coverage/**',
  '**/benchmark/**',
  '**/jscpd-report/**',
  '**/.git/**',
];

const FUNCTION_LIKE_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
]);

const COMPLEXITY_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.CaseClause,
]);

const DEPTH_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.TryStatement,
  ts.SyntaxKind.CatchClause,
]);

const LOGICAL_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

export async function listSourceFiles(rootDir: string): Promise<string[]> {
  return await fg(DEFAULT_PATTERNS, {
    cwd: rootDir,
    absolute: true,
    ignore: DEFAULT_IGNORE,
  });
}

function toPosString(sourceFile: ts.SourceFile, node: ts.Node): string {
  const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  return `${pos.line + 1}:${pos.character + 1}`;
}

function getFileLoc(text: string): number {
  const lines = text.split(/\r\n|\r|\n/u);
  return lines.length;
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclarationBase {
  return FUNCTION_LIKE_KINDS.has(node.kind);
}

function collectFunctionNodes(
  sourceFile: ts.SourceFile
): ts.FunctionLikeDeclarationBase[] {
  const nodes: ts.FunctionLikeDeclarationBase[] = [];
  const visit = (node: ts.Node): void => {
    if (isFunctionLike(node) && node.body) {
      nodes.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return nodes;
}

function getFunctionName(
  node: ts.FunctionLikeDeclarationBase,
  sourceFile: ts.SourceFile
): string {
  if (node.name && ts.isIdentifier(node.name)) {
    return node.name.text;
  }
  return `<anonymous@${toPosString(sourceFile, node)}>`;
}

function getFunctionLength(
  node: ts.FunctionLikeDeclarationBase,
  sourceFile: ts.SourceFile
): number {
  const target = node.body ?? node;
  const start = sourceFile.getLineAndCharacterOfPosition(
    target.getStart()
  ).line;
  const end = sourceFile.getLineAndCharacterOfPosition(target.getEnd()).line;
  return Math.max(0, end - start + 1);
}

function isLogicalOperator(kind: ts.SyntaxKind): boolean {
  return LOGICAL_OPERATORS.has(kind);
}

function isComplexityNode(node: ts.Node): boolean {
  if (COMPLEXITY_KINDS.has(node.kind)) return true;
  return (
    ts.isBinaryExpression(node) && isLogicalOperator(node.operatorToken.kind)
  );
}

function computeComplexity(node: ts.FunctionLikeDeclarationBase): number {
  if (!node.body) return 0;
  let complexity = 1;
  const visit = (child: ts.Node): void => {
    if (child !== node && isFunctionLike(child)) return;
    if (isComplexityNode(child)) complexity += 1;
    ts.forEachChild(child, visit);
  };
  visit(node.body);
  return complexity;
}

function isDepthNode(node: ts.Node): boolean {
  return DEPTH_KINDS.has(node.kind);
}

function computeMaxDepth(node: ts.FunctionLikeDeclarationBase): number {
  if (!node.body) return 0;
  let maxDepth = 0;
  const visit = (child: ts.Node, depth: number): void => {
    if (child !== node && isFunctionLike(child)) return;
    const nextDepth = isDepthNode(child) ? depth + 1 : depth;
    maxDepth = Math.max(maxDepth, nextDepth);
    ts.forEachChild(child, (next) => visit(next, nextDepth));
  };
  visit(node.body, 0);
  return maxDepth;
}

function buildFunctionMetrics(
  node: ts.FunctionLikeDeclarationBase,
  sourceFile: ts.SourceFile
): FunctionMetrics {
  return {
    name: getFunctionName(node, sourceFile),
    complexity: computeComplexity(node),
    length: getFunctionLength(node, sourceFile),
    maxDepth: computeMaxDepth(node),
  };
}

function average(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const sum = numbers.reduce((total, value) => total + value, 0);
  return sum / numbers.length;
}

function maxOf(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  return Math.max(...numbers);
}

function toRelativePath(rootDir: string, filePath: string): string {
  const relative = path.relative(rootDir, filePath);
  return relative.split(path.sep).join('/');
}

export async function buildFileMetrics(
  rootDir: string,
  filePath: string
): Promise<FileMetrics> {
  const text = await readFile(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true
  );
  const functions = collectFunctionNodes(sourceFile).map((node) =>
    buildFunctionMetrics(node, sourceFile)
  );
  const complexities = functions.map((fn) => fn.complexity);
  const lengths = functions.map((fn) => fn.length);
  const depths = functions.map((fn) => fn.maxDepth);

  return {
    path: toRelativePath(rootDir, filePath),
    loc: getFileLoc(text),
    functions,
    avgComplexity: average(complexities),
    maxComplexity: maxOf(complexities),
    maxFunctionLength: maxOf(lengths),
    maxDepth: maxOf(depths),
  };
}

export function summarizeMetrics(files: FileMetrics[]): MetricsSummary {
  const allFunctions = files.flatMap((file) => file.functions);
  const functionComplexities = allFunctions.map((fn) => fn.complexity);
  const functionLengths = allFunctions.map((fn) => fn.length);
  const functionDepths = allFunctions.map((fn) => fn.maxDepth);
  const fileLocs = files.map((file) => file.loc);

  return {
    totalFiles: files.length,
    totalFunctions: allFunctions.length,
    avgComplexity: average(functionComplexities),
    maxComplexity: maxOf(functionComplexities),
    avgFunctionLength: average(functionLengths),
    maxFunctionLength: maxOf(functionLengths),
    maxDepth: maxOf(functionDepths),
    avgFileLoc: average(fileLocs),
    maxFileLoc: maxOf(fileLocs),
  };
}

export function createReport(
  rootDir: string,
  files: FileMetrics[]
): MetricsReport {
  return {
    generatedAt: new Date().toISOString(),
    root: rootDir,
    files,
    summary: summarizeMetrics(files),
  };
}

export async function writeReport(
  report: MetricsReport,
  outPath: string | undefined
): Promise<void> {
  if (!outPath) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  await writeFile(outPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`Metrics written to ${outPath}`);
}
