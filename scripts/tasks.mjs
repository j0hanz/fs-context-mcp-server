/* eslint-disable */
import { spawn } from 'node:child_process';
import { access, chmod, cp, glob, mkdir, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);

// --- Configuration Layer (Constants & Settings) ---
const BIN = {
  tsc: require.resolve('typescript/bin/tsc'),
};

const CONFIG = {
  paths: {
    dist: 'dist',
    assets: 'assets',
    instructions: 'src/instructions.md',
    executable: 'dist/index.js',
    tsBuildInfo: [
      '.tsbuildinfo',
      'tsconfig.tsbuildinfo',
      'tsconfig.build.tsbuildinfo',
    ],
    get distAssets() {
      return join(this.dist, 'assets');
    },
    get distInstructions() {
      return join(this.dist, 'instructions.md');
    },
  },
  commands: {
    tsc: ['node', [BIN.tsc, '-p', 'tsconfig.build.json']],
    tscCheck: ['node', [BIN.tsc, '-p', 'tsconfig.json', '--noEmit']],
  },
  test: {
    patterns: ['src/__tests__/**/*.test.ts', 'tests/**/*.test.ts'],
  },
};

const DEFAULT_TASK_TIMEOUT_MS = Number.parseInt(
  process.env.TASK_TIMEOUT_MS ?? '',
  10
);
const TASK_TIMEOUT_MS =
  Number.isFinite(DEFAULT_TASK_TIMEOUT_MS) && DEFAULT_TASK_TIMEOUT_MS > 0
    ? DEFAULT_TASK_TIMEOUT_MS
    : undefined;

// --- Infrastructure Layer (IO & System) ---
const Logger = {
  startGroup: (name) => process.stdout.write(`> ${name}... `),
  endGroupSuccess: (duration) => console.log(`✅ (${duration}s)`),
  endGroupFail: (err) =>
    console.log(`❌${err?.message ? ` (${err.message})` : ''}`),
  shellSuccess: (name, duration) => console.log(`> ${name} ✅ (${duration}s)`),
  info: (msg) => console.log(msg),
  error: (err) => console.error(err),
  newLine: () => console.log(),
};

const System = {
  async exists(path) {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },
  async isDirectory(path) {
    try {
      const stats = await stat(path);
      return stats.isDirectory();
    } catch {
      return false;
    }
  },

  async remove(paths) {
    const targets = Array.isArray(paths) ? paths : [paths];
    await Promise.all(
      targets.map((p) => rm(p, { recursive: true, force: true }))
    );
  },

  async copy(src, dest, opts = {}) {
    await cp(src, dest, opts);
  },

  async makeDir(path) {
    await mkdir(path, { recursive: true });
  },

  async changeMode(path, mode) {
    await chmod(path, mode);
  },

  exec(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
      const resolvedCommand = command === 'node' ? process.execPath : command;
      const timeoutMs = options.timeoutMs ?? TASK_TIMEOUT_MS;
      const timeoutSignal =
        typeof timeoutMs === 'number' && timeoutMs > 0
          ? AbortSignal.timeout(timeoutMs)
          : undefined;
      const combinedSignal =
        options.signal && timeoutSignal
          ? AbortSignal.any([options.signal, timeoutSignal])
          : (options.signal ?? timeoutSignal);

      if (combinedSignal?.aborted) {
        reject(new Error(`${command} aborted before start`));
        return;
      }

      const proc = spawn(resolvedCommand, args, {
        stdio: 'inherit',
        shell: false,
        windowsHide: true,
        ...(combinedSignal ? { signal: combinedSignal } : {}),
      });

      let aborted = false;
      const abortListener = combinedSignal
        ? () => {
            aborted = true;
          }
        : null;

      if (combinedSignal && abortListener) {
        combinedSignal.addEventListener('abort', abortListener, { once: true });
      }

      const cleanup = () => {
        if (combinedSignal && abortListener) {
          try {
            combinedSignal.removeEventListener('abort', abortListener);
          } catch {
            /* ignore */
          }
        }
      };

      proc.on('error', (error) => {
        cleanup();
        reject(error);
      });

      proc.on('close', (code, signal) => {
        cleanup();
        if (aborted) {
          const suffix = signal ? ` (signal ${signal})` : '';
          reject(new Error(`${command} aborted${suffix}`));
          return;
        }
        if (code === 0) return resolve();
        const suffix = signal ? ` (signal ${signal})` : '';
        reject(new Error(`${command} exited with code ${code}${suffix}`));
      });
    });
  },
};

// --- Domain Layer (Build & Test Actions) ---
const BuildTasks = {
  async clean() {
    await System.remove(CONFIG.paths.dist);
    await System.remove(CONFIG.paths.tsBuildInfo);
  },

  async compile() {
    const [cmd, args] = CONFIG.commands.tsc;
    await System.exec(cmd, args);
  },

  async validate() {
    if (!(await System.exists(CONFIG.paths.instructions))) {
      throw new Error(`Missing ${CONFIG.paths.instructions}`);
    }
  },

  async assets() {
    await System.makeDir(CONFIG.paths.dist);
    await System.copy(CONFIG.paths.instructions, CONFIG.paths.distInstructions);

    if (await System.isDirectory(CONFIG.paths.assets)) {
      await System.copy(CONFIG.paths.assets, CONFIG.paths.distAssets, {
        recursive: true,
      });
    }
  },

  async makeExecutable() {
    await System.changeMode(CONFIG.paths.executable, '755');
  },
};

// --- Test Helpers (Pure Functions) ---
async function detectTestLoader() {
  if (await System.exists('node_modules/tsx')) {
    return ['--import', 'tsx/esm'];
  }
  if (await System.exists('node_modules/ts-node')) {
    return ['--loader', 'ts-node/esm'];
  }
  return [];
}

function getCoverageArgs(args) {
  return args.includes('--coverage') ? ['--experimental-test-coverage'] : [];
}

async function findTestPatterns() {
  const matches = await Promise.all(
    CONFIG.test.patterns.map(async (pattern) => {
      const files = [];
      for await (const entry of glob(pattern)) {
        files.push(entry);
      }
      return files;
    })
  );

  const files = new Set();
  for (const group of matches) {
    for (const file of group) {
      files.add(file);
    }
  }

  return [...files].sort();
}

const TestTasks = {
  async typeCheck() {
    await Runner.runShellTask('Type-checking src', async () => {
      const [cmd, args] = CONFIG.commands.tscCheck;
      await System.exec(cmd, args);
    });
  },

  async test(args = []) {
    await Pipeline.fullBuild();

    const testFiles = await findTestPatterns();
    if (testFiles.length === 0) {
      throw new Error(
        `No test files found. Expected one of: ${CONFIG.test.patterns.join(
          ', '
        )}`
      );
    }

    const loader = await detectTestLoader();
    const coverage = getCoverageArgs(args);

    await Runner.runShellTask('Running tests', async () => {
      await System.exec('node', [
        '--test',
        ...loader,
        ...coverage,
        ...testFiles,
      ]);
    });
  },
};

// --- Application Layer (Task Running & Orchestration) ---
class Runner {
  static async #run(name, fn, logSuccess) {
    Logger.startGroup(name);
    Logger.newLine();
    const start = performance.now();

    try {
      await fn();
      logSuccess(((performance.now() - start) / 1000).toFixed(2));
    } catch (err) {
      Logger.endGroupFail(err);
      throw err;
    }
  }

  static runTask(name, fn) {
    return this.#run(name, fn, Logger.endGroupSuccess);
  }

  static runShellTask(name, fn) {
    return this.#run(name, fn, (d) => Logger.shellSuccess(name, d));
  }
}

const Pipeline = {
  async fullBuild() {
    Logger.info('🚀 Starting build...');
    const start = performance.now();

    await Runner.runTask('Cleaning dist', BuildTasks.clean);
    await Runner.runShellTask('Compiling TypeScript', BuildTasks.compile);
    await Runner.runTask('Validating instructions', BuildTasks.validate);
    await Runner.runTask('Copying assets', BuildTasks.assets);
    await Runner.runTask('Making executable', BuildTasks.makeExecutable);

    Logger.info(
      `\n✨ Build completed in ${((performance.now() - start) / 1000).toFixed(
        2
      )}s`
    );
  },
};

// --- Interface Layer (CLI) ---
const CLI = {
  routes: {
    clean: () => Runner.runTask('Cleaning', BuildTasks.clean),
    'copy:assets': () => Runner.runTask('Copying assets', BuildTasks.assets),
    'validate:instructions': () =>
      Runner.runTask('Validating instructions', BuildTasks.validate),
    'make-executable': () =>
      Runner.runTask('Making executable', BuildTasks.makeExecutable),
    build: Pipeline.fullBuild,
    'type-check': () => TestTasks.typeCheck(),
    test: (args) => TestTasks.test(args),
  },

  async main(args) {
    const rawArgs = args.slice(2);
    let parsed;
    try {
      parsed = parseArgs({
        args: rawArgs,
        allowPositionals: true,
        strict: false,
        tokens: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Logger.error(`Invalid arguments: ${message}`);
      process.exitCode = 1;
      return;
    }

    const tokens = parsed.tokens ?? [];
    const positionalTokens = tokens.filter(
      (token) => token.kind === 'positional'
    );
    let taskIndex = -1;

    for (const token of positionalTokens) {
      const candidate = String(token.value);
      if (candidate in this.routes) {
        taskIndex = token.index;
        break;
      }
    }

    if (taskIndex === -1 && positionalTokens.length > 0) {
      taskIndex = positionalTokens[0].index;
    }

    const taskName = taskIndex >= 0 ? String(rawArgs[taskIndex]) : 'build';
    const restArgs = taskIndex >= 0 ? rawArgs.slice(taskIndex + 1) : [];
    const action = this.routes[taskName];

    if (!action) {
      Logger.error(`Unknown task: ${taskName}`);
      Logger.error(`Available tasks: ${Object.keys(this.routes).join(', ')}`);
      process.exitCode = 1;
      return;
    }

    try {
      await action(restArgs);
    } catch {
      process.exitCode = 1;
    }
  },
};

CLI.main(process.argv);
