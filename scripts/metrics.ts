import path from 'node:path';

import {
  buildFileMetrics,
  createReport,
  listSourceFiles,
  writeReport,
} from './metrics-core.js';

function getArgValue(args: string[], name: string): string | undefined {
  const key = `--${name}`;
  const index = args.indexOf(key);
  if (index >= 0 && index < args.length - 1) {
    return args[index + 1];
  }
  const match = args.find((arg) => arg.startsWith(`${key}=`));
  if (!match) return undefined;
  return match.slice(key.length + 1);
}

function resolveRoot(args: string[]): string {
  const raw = getArgValue(args, 'root');
  if (!raw) return process.cwd();
  return path.resolve(raw);
}

function resolveOutput(args: string[]): string | undefined {
  const raw = getArgValue(args, 'out');
  if (!raw) return undefined;
  return path.resolve(raw);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const rootDir = resolveRoot(args);
  const outPath = resolveOutput(args);
  const files = await listSourceFiles(rootDir);
  const metrics = await Promise.all(
    files.map((filePath) => buildFileMetrics(rootDir, filePath))
  );
  await writeReport(createReport(rootDir, metrics), outPath);
}

await main();
