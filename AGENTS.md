# AGENTS.md

> Purpose: High-signal context and strict guidelines for AI agents working in this repository.

## 1) Project Context

- **Domain:** MCP (Model Context Protocol) server that enables LLMs to interact with the local filesystem — read, write, search, diff, patch, and manage files/directories securely.
- **Tech Stack (Verified):**
  - **Languages:** TypeScript 5.9+ (see `package.json` `devDependencies`), Node.js >=24 (see `package.json` `engines`)
  - **Frameworks:** `@modelcontextprotocol/sdk` ^1.26.0 (see `package.json` `dependencies`)
  - **Key Libraries:**
    - `zod` ^4.3.6 — input/output schema validation (see `package.json`)
    - `diff` ^8.0.3 — unified diff / patch operations (see `package.json`)
    - `ignore` ^7.0.5 — `.gitignore` pattern matching (see `package.json`)
    - `re2` ^1.23.2 — safe regex engine for content search (see `package.json`)
    - `safe-regex2` ^5.0.0 — regex DoS protection (see `package.json`)
- **Architecture:** Single-package MCP server. One tool per file under `src/tools/`, centralized Zod schemas in `src/schemas.ts`, shared helpers/error handling in `src/lib/`, stdio transport by default. (see `src/tools.ts`, `src/server.ts`, `src/index.ts`)

## 2) Repository Map (High-Level)

- `src/index.ts`: CLI entrypoint with shebang (`#!/usr/bin/env node`), signal handling, graceful shutdown (see `src/index.ts`)
- `src/server.ts`: Server creation, MCP Roots management, stdio transport wiring (see `src/server.ts`)
- `src/tools.ts`: `registerAllTools(server, options)` — registers all tool handlers (see `src/tools.ts`)
- `src/schemas.ts`: All Zod input/output schemas using `z.strictObject()` with `.describe()` per param (see `src/schemas.ts`)
- `src/tools/`: One file per tool (e.g., `read.ts`, `edit-file.ts`, `search-content.ts`, `apply-patch.ts`) — each exports a `registerXxxTool()` function (see `src/tools/`)
- `src/tools/shared.ts`: `buildToolResponse`, `buildToolErrorResponse`, `wrapToolHandler`, progress reporting, resource externalization helpers (see `src/tools/shared.ts`)
- `src/lib/`: Shared utilities — error classification (`errors.ts`), path validation/security (`path-validation.ts`, `path-policy.ts`), filesystem helpers (`fs-helpers.ts`), constants, observability, resource store (see `src/lib/`)
- `src/lib/file-operations/`: Core file operation implementations — search, glob, tree, gitignore, read, list (see `src/lib/file-operations/`)
- `src/__tests__/`: Unit tests organized by module (lib, tools, security, server) (see `src/__tests__/`)
- `node-tests/`: Tests that run against compiled `dist/` output (see `node-tests/`)
- `scripts/tasks.mjs`: Build/test task orchestrator — clean, compile, copy assets, run tests (see `scripts/tasks.mjs`)
- `src/config.ts`: Shared type definitions (`FileInfo`, `DirectoryEntry`, `ErrorCode` enum, etc.) (see `src/config.ts`)
- `src/prompts.ts`: MCP prompt registration (see `src/prompts.ts`)
- `src/resources.ts`: MCP resource registration (instructions, result store) (see `src/resources.ts`)
- `.github/workflows/publish.yml`: CI — lint, type-check, test, build, publish to npm on release (see `.github/workflows/publish.yml`)

> Ignore: `dist/`, `node_modules/`, `.ts-trace/`, `artifacts/`, `coverage/`

## 3) Operational Commands (Verified)

- **Environment:** Node.js >=24 required (see `package.json` `engines`); no containerization or virtual env.
- **Install:** `npm ci` (see `.github/workflows/publish.yml` step "Install dependencies")
- **Dev:** `npm run dev` — `tsc --watch --preserveWatchOutput` (see `package.json` `scripts.dev`)
- **Dev run:** `npm run dev:run` — `node --env-file=.env --watch dist/index.js` (see `package.json` `scripts.dev:run`)
- **Test:** `npm run test` — builds first, then runs `node --test` with `tsx` loader on `src/__tests__/**/*.test.ts` (see `package.json` `scripts.test`, `scripts/tasks.mjs`)
- **Test with coverage:** `npm run test:coverage` — same as test with `--experimental-test-coverage` (see `package.json`)
- **Build:** `npm run build` — clean → compile (`tsc -p tsconfig.build.json`) → validate instructions → copy assets → chmod executable (see `package.json` `scripts.build`, `scripts/tasks.mjs`)
- **Lint:** `npm run lint` — `eslint .` (see `package.json` `scripts.lint`, `.github/workflows/publish.yml`)
- **Lint fix:** `npm run lint:fix` — `eslint . --fix` (see `package.json`)
- **Format:** `npm run format` — `prettier --write .` (see `package.json` `scripts.format`)
- **Type-check:** `npm run type-check` — `tsc --noEmit` against `tsconfig.json` (see `package.json`, `scripts/tasks.mjs`)
- **Dead code:** `npm run knip` — unused exports/deps detection (see `package.json`, `knip.json`)
- **Inspector:** `npm run inspector` — launches MCP Inspector against built output (see `package.json`)

## 4) Coding Standards (Style & Patterns)

- **Naming:** camelCase for variables/functions, PascalCase for types/enums, UPPER_CASE for constants. Enforced via `@typescript-eslint/naming-convention` (see `eslint.config.mjs`). Leading underscores allowed for unused params (see `eslint.config.mjs` `varsIgnorePattern`).
- **Imports:** Named exports only — no default exports. Type-only imports enforced (`import type { X }`). `.js` extensions required in local imports (NodeNext module resolution). Import order enforced by `@trivago/prettier-plugin-sort-imports`: node builtins → MCP SDK → zod → third-party → local (see `.prettierrc`).
- **Formatting:** Prettier — single quotes, trailing commas (`es5`), 2-space indent, 80 char width, LF line endings (see `.prettierrc`).
- **Typing/Strictness:** TypeScript `strict` mode with additional flags: `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noImplicitOverride`, `useUnknownInCatchVariables` (see `tsconfig.json`). Explicit return types required on functions (see `eslint.config.mjs` `explicit-function-return-type`). `no-explicit-any` is error-level (see `eslint.config.mjs`).
- **Patterns Observed:**
  - **One tool per file:** Each tool in `src/tools/` exports a single `registerXxxTool(server, options)` function that calls `server.registerTool()` (observed in `src/tools/read.ts`, `src/tools/edit-file.ts`).
  - **Schema-first design:** All input/output schemas defined centrally in `src/schemas.ts` using `z.strictObject()` with `.describe()` on every parameter (observed in `src/schemas.ts`).
  - **Dual content returns:** Every tool response includes both `content: [{ type: 'text', text }]` AND `structuredContent` via `buildToolResponse()` / `buildToolErrorResponse()` (observed in `src/tools/shared.ts`).
  - **Error handling:** Errors are caught at the tool level and returned as `{ isError: true, structuredContent: { ok: false, error: { code, message, suggestion } } }` — never thrown as uncaught exceptions. Error codes defined in `src/config.ts`, classified in `src/lib/errors.ts` (observed in `src/tools/shared.ts`, `src/lib/errors.ts`).
  - **Guard + progress wrapper:** Tool handlers use `wrapToolHandler()` for initialization guards and progress notifications (observed in `src/tools/read.ts`).
  - **Resource externalization:** Large outputs (>20k chars) are stored via `ResourceStore` and returned as resource links (observed in `src/tools/shared.ts`).
  - **Timed abort signals:** All file operations use `createTimedAbortSignal()` to enforce timeouts (observed in `src/tools/read.ts`, `src/index.ts`).
  - **Path security:** All paths validated against allowed directories with symlink-escape protection (observed in `src/lib/path-validation.ts`, `src/__tests__/security/`).

## 5) Agent Behavioral Rules (Do Nots)

- Do not introduce new dependencies without updating `package.json` and `package-lock.json` via npm. (see `package-lock.json` presence)
- Do not edit `package-lock.json` manually. (see `package-lock.json`)
- Do not commit secrets; never print `.env` values; use `--env-file=.env` for local config. (see `.gitignore` listing `.env*`)
- Do not use default exports — named exports only. (see `eslint.config.mjs` `consistent-type-imports`, `.github/instructions/typescript-mcp-server.instructions.md`)
- Do not use `any` — `@typescript-eslint/no-explicit-any` is set to `error`. (see `eslint.config.mjs`)
- Do not disable or bypass existing lint/type rules without explicit approval. (see `eslint.config.mjs`, `tsconfig.json`)
- Do not throw uncaught exceptions from tool handlers — always return error responses via `buildToolErrorResponse()`. (see `src/tools/shared.ts`, `.github/instructions/typescript-mcp-server.instructions.md`)
- Do not write non-MCP output to stdout — use `console.error()` for diagnostics. (see `.github/instructions/typescript-mcp-server.instructions.md`)
- Do not omit `.js` extensions in local imports. (see `tsconfig.json` `moduleResolution: "NodeNext"`, `.github/instructions/typescript-mcp-server.instructions.md`)
- Do not omit `.describe()` on Zod schema parameters. (see `.github/instructions/typescript-mcp-server.instructions.md`, `src/schemas.ts`)
- Do not create tool schemas with `z.object()` — use `z.strictObject()` to reject unknown fields. (see `.github/instructions/typescript-mcp-server.instructions.md`, `src/schemas.ts`)
- Do not change public tool names/schemas without updating tests and documentation. (see `src/__tests__/tools/`)

## 6) Testing Strategy (Verified)

- **Framework:** Node.js built-in test runner (`node:test`) with `assert` from `node:assert/strict` (see `scripts/tasks.mjs`, `src/__tests__/tools/tool-response.test.ts`)
- **Loader:** `tsx` for running TypeScript tests directly (see `scripts/tasks.mjs` `detectTestLoader()`, `package.json` devDependencies)
- **Where tests live:**
  - `src/__tests__/lib/` — unit tests for library modules (errors, path validation, resource store) (see `src/__tests__/lib/`)
  - `src/__tests__/tools/` — unit tests for tool handlers (response shape, defaults, write ops, diagnostics) (see `src/__tests__/tools/`)
  - `src/__tests__/security/` — security boundary tests (filesystem boundary, symlink escape) (see `src/__tests__/security/`)
  - `src/__tests__/server/` — server setup tests (argument parsing) (see `src/__tests__/server/`)
  - `node-tests/` — tests that run against compiled `dist/` output (see `node-tests/`, `knip.json`)
- **Approach:** Pure unit tests, no external services/containers. Tests use `assert.strictEqual`, `assert.deepStrictEqual`, `assert.throws`. File patterns: `src/__tests__/**/*.test.ts` and `tests/**/*.test.ts` (see `scripts/tasks.mjs` `CONFIG.test.patterns`). Tests are excluded from the TypeScript build via `tsconfig.json` `exclude`.
- **Run single test:** `node --test --import tsx/esm src/__tests__/path/to/test.test.ts`

## 7) Common Pitfalls (Verified Only)

- **Build before test:** `npm run test` triggers a full build first (`Pipeline.fullBuild()` in `scripts/tasks.mjs`). If you only want type-checking, use `npm run type-check` instead.
- **Shebang required:** `src/index.ts` MUST start with `#!/usr/bin/env node` as the very first line — no BOM, no blank lines before it. (see `.github/instructions/typescript-mcp-server.instructions.md`)
- **Instructions.md bundled:** `src/instructions.md` is copied to `dist/` during build and loaded at runtime. If missing, the build will fail at the validation step. (see `scripts/tasks.mjs` `BuildTasks.validate`)
- **Multiple roots ambiguity:** When multiple workspace roots are configured, tools require an explicit `path` argument — omitting it throws `E_INVALID_INPUT`. (see `src/tools/shared.ts` `resolvePathOrRoot()`)
- **Regex safety:** Content search uses `re2` and `safe-regex2` to prevent ReDoS. Custom regex patterns must be compatible with RE2 syntax. (see `package.json` dependencies)

## 8) Evolution Rules

- If conventions change, include an `AGENTS.md` update in the same PR.
- If a command is corrected after failures, record the final verified command here.
- If a new critical path or pattern is discovered, add it to the relevant section with evidence.
