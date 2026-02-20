# AGENTS.md

> Purpose: High-signal context and strict guidelines for AI agents working in this repository.

## 1) Project Context

- **Domain:** MCP (Model Context Protocol) server that enables LLMs to interact safely with the local filesystem — read, search, edit, diff, patch, and traverse directory trees. (see `package.json`)
- **Tech Stack (Verified):**
  - **Languages:** TypeScript 5.9.x targeting ES2022/NodeNext (see `tsconfig.json`, `package.json` devDependencies)
  - **Runtime:** Node.js ≥ 24 required (see `package.json` `engines.node`)
  - **Frameworks:** `@modelcontextprotocol/sdk` ^1.26.0 (MCP server + transports); no web framework (see `package.json` dependencies)
  - **Key Libraries:** `zod` ^4.3.6 (schema validation + tool I/O), `re2` ^1.23.2 (safe regex engine), `diff` ^8.0.3 (unified diff generation), `ignore` ^7.0.5 (`.gitignore`-style filtering), `commander` ^14.0.3 (CLI arg parsing) (see `package.json` dependencies)
- **Architecture:** Single-package Node.js MCP server. Dual-transport: stdio (default) and HTTP (`--port` flag). Tools follow a `ToolContract` interface declared in `src/tools/contract.ts`. Zod v4 schemas in `src/schemas.ts` govern all I/O. Environment variable-driven configuration in `src/lib/constants.ts`. Sensitive-file blocking enforced at the path-policy layer (`src/lib/path-policy.ts`).

## 2) Repository Map (High-Level)

- `src/index.ts`: CLI entrypoint — parses args, sets allowed directories, starts stdio or HTTP transport
- `src/server/`: MCP server bootstrap, capability declaration, roots-manager, logging state, and type definitions (see `src/server/bootstrap.ts`, `src/server/roots-manager.ts`)
- `src/tools/`: 21 tool implementations (one file per tool) — read, write, edit, find, grep, tree, ls, stat, diff, patch, move, delete, hash, etc. (see `src/tools/`)
- `src/tools/contract.ts`: `ToolContract` interface — every tool must declare `name`, `title`, `description`, `inputSchema`, `outputSchema`, `annotations`, `nuances`, `gotchas`
- `src/schemas.ts`: Zod v4 schemas for all tool input/output types; uses `z.strictObject` (rejects unknown keys)
- `src/lib/`: Shared utilities — `constants.ts` (env-configured limits), `errors.ts` (`ErrorCode` enum + `McpError`), `path-policy.ts` (sensitive-file deny/allow list), `path-validation.ts` (allowed directories), `fs-helpers.ts`, `path-format.ts`, `observability.ts`, `resource-store.ts`, `type-guards.ts`
- `src/resources/`: MCP resource registrations (instructions, metrics, result cache)
- `src/completions.ts`, `src/prompts.ts`, `src/resources.ts`: MCP completions, prompts, and resource registration entry points
- `src/cli.ts`: CLI argument parsing using `commander`
- `src/__tests__/`: All test files organized by subsystem (`tools/`, `lib/`, `server/`, `integration/`, `security/`, `shared/`)
- `scripts/tasks.mjs`: Custom build/test pipeline (clean → compile → copy assets → make executable)
- `.github/workflows/release.yml`: Only CI workflow — manual release trigger; validates lint + type-check + test + build before publishing
- `docker-compose.yml`: Docker Compose definition (exists at repo root)
- `assets/`: Static assets (logo.svg) copied to `dist/assets/` on build
- `server.json`: MCP Registry manifest; version kept in sync with `package.json` on release

> Ignore generated/vendor dirs: `dist/`, `node_modules/`, `.tsbuildinfo`.

## 3) Operational Commands (Verified)

**Source of truth:** `.github/workflows/release.yml` (`Install & validate` step) and `package.json` scripts.

- **Environment:** Node.js ≥ 24 required; no virtual env or container needed for local dev. (see `package.json` `engines`)
- **Install:** `npm ci` (see release.yml line `npm ci`)
- **Dev (watch):** `npm run dev` → `tsc --watch --preserveWatchOutput` (see `package.json` scripts)
- **Dev (run built):** `npm run dev:run` → `node --env-file=.env --watch dist/index.js` (see `package.json` scripts)
- **Test:** `npm run test` → `node scripts/tasks.mjs test` — **automatically runs a full build first**, then invokes `node --test --import tsx/esm <patterns>` (see `scripts/tasks.mjs` `TestTasks.test`)
- **Test (fast, no rebuild):** `npm run test:fast` → `node --test --import tsx/esm src/__tests__/**/*.test.ts node-tests/**/*.test.ts` (see `package.json` scripts)
- **Test (coverage):** `npm run test:coverage` → adds `--experimental-test-coverage` flag (see `package.json` scripts)
- **Build:** `npm run build` → `node scripts/tasks.mjs build` (clean → tsc → copy assets → chmod 755 on executable) (see `scripts/tasks.mjs`)
- **Lint:** `npm run lint` → `eslint .` (see `package.json` scripts)
- **Lint (fix):** `npm run lint:fix` → `eslint . --fix`
- **Format:** `npm run format` → `prettier --write .` (see `package.json` scripts)
- **Type-check:** `npm run type-check` → checks `src/` with `tsconfig.json` and tests with `tsconfig.test.json`, both `--noEmit` (see `scripts/tasks.mjs` `TestTasks.typeCheck`)
- **MCP Inspector:** `npm run inspector` → builds then opens `@modelcontextprotocol/inspector` (see `package.json` scripts)

## 4) Coding Standards (Style & Patterns)

- **Naming:** `camelCase` for variables/functions/parameters; `PascalCase` for types, classes, interfaces, enum members; `UPPER_CASE` for module-level constants; `_`-prefixed names for intentionally unused values (see `eslint.config.mjs` `@typescript-eslint/naming-convention` rules)
- **Structure:** Business logic in `src/lib/`; tool declarations in `src/tools/` (one file per tool); schemas centralized in `src/schemas.ts`; server wiring in `src/server/`; entrypoint in `src/index.ts`
- **Imports:** `import type { ... }` required for type-only imports (enforced by `@typescript-eslint/consistent-type-imports` with `prefer: 'type-imports'`). All imports must use `.js` extension due to `verbatimModuleSyntax` + NodeNext module resolution (see `tsconfig.json`, `eslint.config.mjs`)
- **Explicit return types:** All non-expression functions must declare return type (enforced: `@typescript-eslint/explicit-function-return-type: error`, see `eslint.config.mjs`)
- **Typing/Strictness:** Full strict mode — `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns` all enabled (see `tsconfig.json`)
- **Zod schemas:** Use `z.strictObject` (not `z.object`) so unknown keys are rejected at parse time (observed in `src/schemas.ts`)
- **Error handling:** Throw `McpError` with `ErrorCode` enum values; never throw plain strings (observed in `src/lib/errors.ts`, `src/lib/path-policy.ts`)
- **Environment configuration:** All configurable limits live in `src/lib/constants.ts` with `parseEnvInt`/`parseEnvBool`/`parseEnvList` helpers; hard bounds enforced (observed in `src/lib/constants.ts`)
- **Patterns Observed:**
  - `ToolContract` interface in `src/tools/contract.ts` — every tool self-describes its annotations, nuances, and gotchas for auto-generated instructions
  - WeakMap for server-scoped state (`rootsManagers` WeakMap) to avoid memory leaks (observed in `src/server/bootstrap.ts`)
  - Timing-safe comparison (`timingSafeEqual`) for HTTP API key auth (observed in `src/server/bootstrap.ts`)
  - `node:test` and `node:assert/strict` (no third-party test framework) — tests use `void it(...)` pattern (observed in `src/.__tests__/tools/tool-defaults.test.ts`)
  - `tsx/esm` loader for running TypeScript tests without pre-compilation (observed in `scripts/tasks.mjs`, `package.json`)

## 5) Agent Behavioral Rules (Do Nots)

- **Do not introduce new dependencies** without running `npm install <pkg>` (or `npm install --save-dev <pkg>`) to update both `package.json` and `package-lock.json`. (see `package-lock.json` presence)
- **Do not edit `package-lock.json` manually.** Use `npm` commands only. (see `package-lock.json`)
- **Do not commit secrets or print `.env` values.** The HTTP transport blocks unauthorized requests via `FILESYSTEM_MCP_API_KEY` env var using timing-safe comparison. Never log or expose this value. (see `src/server/bootstrap.ts`)
- **Do not change public tool schemas or `ToolContract` fields** without updating `src/schemas.ts`, affected tool files, and verifying that the `internal://instructions` resource still builds correctly (`src/resources/generated-instructions.ts`). MCP clients depend on stable tool names and schemas.
- **Do not use `z.object()`** in new schemas — use `z.strictObject()` to reject unknown keys consistently. (see `src/schemas.ts`)
- **Do not write `import { Foo }` for type-only symbols** — always use `import type { Foo }`. ESLint enforces this and will fail CI. (see `eslint.config.mjs` `consistent-type-imports`)
- **Do not omit `.js` extensions in import paths.** `verbatimModuleSyntax` + NodeNext require explicit `.js` extensions even for `.ts` source files. (see `tsconfig.json`)
- **Do not add `any` types** — `@typescript-eslint/no-explicit-any: error` is enforced in `src/**/*.ts`. (see `eslint.config.mjs`)
- **Do not disable or bypass lint/type rules** without an inline `// ts-expect-error <description>` comment of at least 10 characters. `ts-ignore` is allowed but also requires a description. `ts-nocheck` is banned. (see `eslint.config.mjs` `ban-ts-comment` rule)
- **Do not modify `server.json` version manually.** It is kept in sync with `package.json` via the release workflow. (see `.github/workflows/release.yml`)
- **Do not skip verification after changes.** The release pipeline enforces `lint → type-check → test → build` in that order. (see `.github/workflows/release.yml` `Install & validate` step)

## 6) Testing Strategy (Verified)

- **Framework:** Node.js built-in `node:test` runner with `node:assert/strict` assertions (no jest/vitest). (seen in `src/__tests__/tools/tool-defaults.test.ts`, `package.json`)
- **TypeScript loader:** `tsx/esm` — tests run directly against `.ts` source files via `--import tsx/esm`. (see `scripts/tasks.mjs` `detectTestLoader`)
- **Where tests live:**
  - `src/__tests__/tools/` — per-tool unit/behavioral tests (17 files, e.g., `tool-defaults.test.ts`, `grep-regex-mode.test.ts`, `task-support.test.ts`)
  - `src/__tests__/lib/` — library unit tests
  - `src/__tests__/server/` — server unit tests
  - `src/__tests__/integration/` — integration tests
  - `src/__tests__/security/` — security/policy tests (e.g., `sensitive-policy.test.ts`)
  - `src/__tests__/shared/` — shared test helpers and diagnostic utilities
  - `tests/` and `node-tests/` — additional test directories (pattern-matched; only included if directories exist)
- **Approach:** Unit tests use Zod schema `.parse()` and direct handler invocation via `createSingleToolCapture()` helper from `src/__tests__/shared/diagnostics-env.ts`. Integration tests exercise server lifecycle. Security tests verify sensitive-file policy enforcement. No external services or containers required (all in-process). (see `src/__tests__/tools/tool-defaults.test.ts`, `src/__tests__/security/`)
- **Running tests fast (no rebuild):** Use `npm run test:fast` to skip the full build step during iteration.
- **Coverage:** `npm run test:coverage` adds `--experimental-test-coverage` (Node.js built-in).

## 7) Common Pitfalls (Verified)

- **Missing `.js` extension in imports** → TypeScript compilation succeeds locally but Node.js ESM resolution fails at runtime. Always use `.js` extension in import paths (e.g., `import { foo } from './foo.js'`). (see `tsconfig.json` `verbatimModuleSyntax` + NodeNext)
- **`npm run test` rebuilds on every run** → Use `npm run test:fast` during development to skip the `build` step and run tests directly against source via `tsx/esm`. (see `scripts/tasks.mjs` `TestTasks.test` which calls `Pipeline.fullBuild()` first)
- **`z.object()` allows extra keys** → Use `z.strictObject()` for all MCP tool I/O schemas; existing tests assert `Unrecognized key` errors on schemas with unknown fields. (see `src/__tests__/tools/tool-defaults.test.ts`)
- **`node:test` requires `void` prefix on top-level async tests** → Write `void it(...)` at the module top level to prevent floating promise warnings. (observed in `src/__tests__/tools/tool-defaults.test.ts`)
- **`@typescript-eslint/no-non-null-assertion` vs non-nullable assertion style** → Use narrowing (`if (val !== undefined)`) instead of `!` or `as T` casts to avoid dual ESLint rule conflicts. (see user memory `patterns.md`)

## 8) Evolution Rules

- If conventions change, include an `AGENTS.md` update in the same PR.
- If a command is corrected after failures, record the final verified command here.
- If a new critical path or pattern is discovered, add it to the relevant section with evidence (file path).
- If a new tool is added to `src/tools/`, it must implement `ToolContract` and be registered in `src/tools.ts`; update this file's tool inventory note if the tool count changes.
- If environment variables are added to `src/lib/constants.ts`, document them in Section 3 under the relevant command.
