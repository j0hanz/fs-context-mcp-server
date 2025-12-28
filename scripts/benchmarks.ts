import * as path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';

import {
  getFileInfo,
  listDirectory,
  readFile,
  readMultipleFiles,
  searchContent,
  searchFiles,
} from '../src/lib/file-operations.js';
import { setAllowedDirectories } from '../src/lib/path-validation.js';

interface BenchmarkResult {
  name: string;
  avgMs: number;
  p95Ms: number;
  memDeltaMb: number;
}

interface BenchmarkCase {
  name: string;
  run: () => Promise<void>;
}

interface BenchmarkContext {
  root: string;
  sampleFile: string;
}

interface BenchmarkSpec {
  name: string;
  run: (context: BenchmarkContext) => Promise<void>;
}

async function createFixtureDirectories(
  root: string,
  folders: string[]
): Promise<void> {
  await Promise.all(
    folders.map((folder) => mkdir(path.join(root, folder), { recursive: true }))
  );
}

function buildFixtureContent(): string {
  return [
    'lorem ipsum dolor sit amet',
    'consectetur adipiscing elit',
    'sed do eiusmod tempor incididunt',
    'ut labore et dolore magna aliqua',
  ].join('\n');
}

async function writeFixtureFiles(
  root: string,
  baseContent: string,
  count: number
): Promise<string> {
  const writeOps: Promise<void>[] = [];
  let sampleFile = '';

  for (let i = 0; i < count; i++) {
    const folder = i % 3 === 0 ? 'alpha' : i % 3 === 1 ? 'beta' : 'gamma';
    const filePath = path.join(root, folder, `file-${i}.txt`);
    const content = `${baseContent}\nitem:${i}\n${baseContent}`;
    writeOps.push(writeFile(filePath, content, 'utf-8'));
    if (i === 0) {
      sampleFile = filePath;
    }
  }

  await Promise.all(writeOps);
  return sampleFile;
}

async function createFixture(): Promise<BenchmarkContext> {
  const root = await mkdtemp(path.join(tmpdir(), 'fs-mcp-bench-'));
  const folders = ['alpha', 'beta', 'gamma', 'alpha/nested', 'beta/logs'];
  await createFixtureDirectories(root, folders);
  const baseContent = buildFixtureContent();
  const sampleFile = await writeFixtureFiles(root, baseContent, 120);

  return { root, sampleFile };
}

async function measure(
  name: string,
  iterations: number,
  fn: () => Promise<void>
): Promise<BenchmarkResult> {
  const samples: number[] = [];
  let memDeltaTotal = 0;

  for (let i = 0; i < iterations; i++) {
    const beforeMem = process.memoryUsage().heapUsed;
    const start = performance.now();
    await fn();
    const end = performance.now();
    const afterMem = process.memoryUsage().heapUsed;
    samples.push(end - start);
    memDeltaTotal += afterMem - beforeMem;
  }

  const avgMs = samples.reduce((sum, v) => sum + v, 0) / samples.length;
  const p95Ms = percentile(samples, 95);
  const memDeltaMb = memDeltaTotal / iterations / (1024 * 1024);

  return {
    name,
    avgMs,
    p95Ms,
    memDeltaMb,
  };
}

function percentile(samples: number[], target: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((target / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

async function runBenchmarks(): Promise<BenchmarkResult[]> {
  const context = await createFixture();
  setAllowedDirectories([context.root]);

  try {
    return await runBenchmarkCases(buildBenchmarkCases(context), 5);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
}

const BENCHMARK_SPECS: BenchmarkSpec[] = [
  {
    name: 'listDirectory(recursive)',
    run: async ({ root }) => {
      await listDirectory(root, { recursive: true, maxDepth: 3 });
    },
  },
  {
    name: 'searchFiles(**/*.txt)',
    run: async ({ root }) => {
      await searchFiles(root, '**/*.txt', ['**/logs/**'], {
        maxResults: 200,
      });
    },
  },
  {
    name: 'searchContent(lorem)',
    run: async ({ root }) => {
      await searchContent(root, 'lorem', {
        filePattern: '**/*.txt',
        maxResults: 200,
        contextLines: 1,
      });
    },
  },
  {
    name: 'getFileInfo',
    run: async ({ sampleFile }) => {
      await getFileInfo(sampleFile);
    },
  },
  {
    name: 'readMultipleFiles(head)',
    run: async ({ sampleFile }) => {
      await readMultipleFiles([sampleFile], { head: 5 });
    },
  },
  {
    name: 'readFile(head)',
    run: async ({ sampleFile }) => {
      await readFile(sampleFile, { head: 10 });
    },
  },
];

function buildBenchmarkCases(context: BenchmarkContext): BenchmarkCase[] {
  return BENCHMARK_SPECS.map((spec) => ({
    name: spec.name,
    run: () => spec.run(context),
  }));
}

async function runBenchmarkCases(
  cases: BenchmarkCase[],
  iterations: number
): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  for (const benchmark of cases) {
    results.push(await measure(benchmark.name, iterations, benchmark.run));
  }
  return results;
}

function renderTable(results: BenchmarkResult[]): void {
  console.log('| Benchmark | Avg ms | P95 ms | Mem Delta (MB) |');
  console.log('| --- | ---: | ---: | ---: |');
  for (const result of results) {
    console.log(
      `| ${result.name} | ${result.avgMs.toFixed(2)} | ${result.p95Ms.toFixed(2)} | ${result.memDeltaMb.toFixed(2)} |`
    );
  }
}

async function main(): Promise<void> {
  const results = await runBenchmarks();
  renderTable(results);
  console.log('\nJSON:', JSON.stringify(results, null, 2));
}

await main();
