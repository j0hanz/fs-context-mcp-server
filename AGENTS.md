# AGENTS.md

> Purpose: High-signal context and strict guidelines for AI agents working in this repository.

## 1) Project Context

- **Domain:** MCP Server enabling LLMs to interact with the local filesystem through secure, validated operations.
- **Tech Stack (Verified):**
  - **Languages:** TypeScript 5.9.3 (see [package.json](package.json), [tsconfig.json](tsconfig.json))
  - **Runtime:** Node.js >=24 (see [package.json](package.json) `engines.node`)
  - **Framework:** Model Context Protocol (MCP) via `@modelcontextprotocol/sdk` 1.26.0 (see [package.json](package.json))
  - **Key Libraries:**
    - Zod 4.3.6 (schema validation, see [package.json](package.json))
    - RE2 1.23.2 (safe regex, see [package.json](package.json))
    - ignore 7.0.5 (.gitignore parsing, see [package.json](package.json))
    - safe-regex2 5.0.0 (ReDoS protection, see [package.json](package.json))
- **Architecture:** MCP tool-based server with strict path validation and double-check security pattern (see [src/lib/path-validation.ts](src/lib/path-validation.ts))

## 2) Repository Map (High-Level)

- `src/`: TypeScript source code
  - `index.ts`: CLI entrypoint (see [src/index.ts](src/index.ts))
  - `server.ts`: MCP server initialization and transport (see [src/server.ts](src/server.ts))
  - `tools/`: 15 MCP tool implementations (create-directory, write-file, edit-file, move-file, delete-file, read, read-multiple, list-directory, tree, search-files, search-content, stat, stat-many, roots) (see [src/tools/](src/tools/))
  - `lib/`: Core utilities
    - `path-validation.ts`: Double-check path validation for symlink escape prevention (see [src/lib/path-validation.ts](src/lib/path-validation.ts))
    - `errors.ts`: Typed error handling and classification (see [src/lib/errors.ts](src/lib/errors.ts))
    - `fs-helpers.ts`: AbortSignal-aware file operations (see [src/lib/fs-helpers.ts](src/lib/fs-helpers.ts))
    - `observability.ts`: AsyncLocalStorage-based ops tracing
    - `file-operations/`: Search, tree, read implementations
  - `__tests__/`: 46 test files covering unit, integration, and security (see [src/**tests**/](src/__tests__/))
  - `schemas.ts`: Zod input/output schemas for all MCP tools (see [src/schemas.ts](src/schemas.ts))
  - `resources.ts`: MCP resource registration (instructions, result cache)
- `scripts/`: Build and test orchestration
  - `tasks.mjs`: Unified task runner for build/clean/test (see [scripts/tasks.mjs](scripts/tasks.mjs))
- `dist/`: Build output (TypeScript compilation target, see [tsconfig.json](tsconfig.json))
- `assets/`: Static assets (logo, etc.)
- `.github/workflows/`: CI configuration
  - `publish.yml`: npm publish workflow (see [.github/workflows/publish.yml](.github/workflows/publish.yml))

> Ignore generated/vendor dirs like `dist/`, `node_modules/`, `.tsbuildinfo` files.

## 3) Operational Commands (Verified)

- **Environment:** Node.js >=24 (see [package.json](package.json) `engines.node`)
- **Install:** `npm ci` (see [.github/workflows/publish.yml](.github/workflows/publish.yml) line 30)
- **Dev:** `npm run dev` → `tsc --watch --preserveWatchOutput` (see [package.json](package.json) `scripts.dev`)
- **Dev Run:** `npm run dev:run` → `node --env-file=.env --watch dist/index.js` (see [package.json](package.json) `scripts.dev:run`)
- **Test:** `npm test` → `node scripts/tasks.mjs test` (uses `node:test` with `tsx/esm` loader for TypeScript, see [scripts/tasks.mjs](scripts/tasks.mjs) and [.github/workflows/publish.yml](.github/workflows/publish.yml) line 39)
- **Build:** `npm run build` → `node scripts/tasks.mjs build` (runs `tsc -p tsconfig.build.json`, validates instructions, copies assets, chmods entrypoint, see [package.json](package.json) `scripts.build` and [.github/workflows/publish.yml](.github/workflows/publish.yml) line 42)
- **Lint/Format:**
  - Lint: `npm run lint` → `eslint .` (see [package.json](package.json) `scripts.lint` and [.github/workflows/publish.yml](.github/workflows/publish.yml) line 33)
  - Format: `npm run format` → `prettier --write .` (see [package.json](package.json) `scripts.format`)
  - Type-check: `npm run type-check` → `node scripts/tasks.mjs type-check` (runs `tsc --noEmit`, see [package.json](package.json) `scripts.type-check` and [.github/workflows/publish.yml](.github/workflows/publish.yml) line 36)

## 4) Coding Standards (Style & Patterns)

- **Naming:** (see [eslint.config.mjs](eslint.config.mjs) `@typescript-eslint/naming-convention`)
  - Variables: `camelCase`, `UPPER_CASE` (constants), `PascalCase` (constructors)
  - Types: `PascalCase`
  - Functions: `camelCase`
  - No leading/trailing underscores except `_` for unused vars
- **Structure:** (observed in [src/](src/))
  - Business logic lives in `src/lib/file-operations/` and `src/tools/`
  - Path validation is centralized in `src/lib/path-validation.ts` (double-check pattern)
  - Error handling is centralized in `src/lib/errors.ts` with ErrorCode enum
  - MCP tools are registered via individual `register*Tool()` functions in `src/tools/*.ts`
  - All async operations accept optional `AbortSignal` for cancellation (see [src/lib/fs-helpers.ts](src/lib/fs-helpers.ts))
- **Typing/Strictness:** (see [tsconfig.json](tsconfig.json))
  - TypeScript `strict: true` with additional flags:
    - `noUncheckedIndexedAccess: true`
    - `exactOptionalPropertyTypes: true`
    - `noImplicitReturns: true`
    - `noFallthroughCasesInSwitch: true`
  - Explicit function return types required (see [eslint.config.mjs](eslint.config.mjs) `@typescript-eslint/explicit-function-return-type`)
  - Type imports use `type` keyword (see [eslint.config.mjs](eslint.config.mjs) `@typescript-eslint/consistent-type-imports`)
- **Patterns Observed:**
  - **Double-check path validation** (seen in [src/lib/path-validation.ts](src/lib/path-validation.ts) `validateExistingPathDetailsInternal`):
    1. Normalize requested path
    2. Check against allowed directories
    3. Resolve symlinks via `fs.realpath`
    4. Normalize resolved path
    5. Re-check resolved path against allowed directories
    - This prevents symlink escape attacks.
  - **AbortSignal propagation** (seen throughout [src/lib/fs-helpers.ts](src/lib/fs-helpers.ts)): All async file operations accept optional `signal?: AbortSignal` and use `withAbort()` wrapper for native fs operations.
  - **Worker thread pool** (seen in [src/lib/file-operations/search-content.ts](src/lib/file-operations/search-content.ts)): CPU-intensive search operations use worker threads for parallelism.
  - **AsyncLocalStorage for context** (seen in [src/lib/observability.ts](src/lib/observability.ts)): Tool context (name, path) is tracked via AsyncLocalStorage for tracing without manual plumbing.
  - **Resource externalization** (seen in [src/tools/shared.ts](src/tools/shared.ts)): Large content (>20KB) is offloaded to MCP resource URIs (`fs-context://result/{id}`) instead of inline JSON.
  - **No enums, no default exports** (observed in all source files): Use `const` objects with `as const satisfies` for enums; all exports are named.

## 5) Agent Behavioral Rules (Do Nots)

- Do not introduce new dependencies without updating [package.json](package.json) via the package manager (`npm install`).
- Do not edit [package-lock.json](package-lock.json) manually. (lockfile present)
- Do not commit secrets; never print `.env` values; use existing secret/config mechanisms. (MCP protocol security requirement)
- Do not change public APIs (tool schemas in [src/schemas.ts](src/schemas.ts)) without updating tests and documentation.
- Do not bypass path validation in [src/lib/path-validation.ts](src/lib/path-validation.ts). The double-check pattern is critical for security against symlink escape attacks.
- Do not introduce path traversal risks. All paths must be validated via `validatePath()` or `validateExistingPath()` from [src/lib/path-validation.ts](src/lib/path-validation.ts).
- Do not disable or bypass existing lint/type rules in [eslint.config.mjs](eslint.config.mjs) or [tsconfig.json](tsconfig.json) without explicit approval and justification.
- Do not use `any` type. Use `unknown` and type guards. (enforced by [eslint.config.mjs](eslint.config.mjs) `@typescript-eslint/no-explicit-any`)
- Do not use `enum`. Use `const` objects with `as const satisfies` instead. (codebase convention)
- Do not use `export default`. Use named exports only. (codebase convention)
- Do not skip `AbortSignal` support when adding new async operations. All file operations MUST accept optional `signal?: AbortSignal`.

## 6) Testing Strategy (Verified)

- **Framework:** `node:test` (native Node.js test runner) with `tsx/esm` loader for TypeScript (see [scripts/tasks.mjs](scripts/tasks.mjs))
- **Where tests live:** `src/__tests__/` (46 test files, see [src/**tests**/](src/__tests__/))
- **Approach:** (observed in test files)
  - **Unit tests:** Isolated testing of individual functions (e.g., [src/**tests**/lib/errors-classify.test.ts](src/__tests__/lib/errors-classify.test.ts))
  - **Integration tests:** Full tool invocation with fake MCP server (e.g., [src/**tests**/tools/write-ops.test.ts](src/__tests__/tools/write-ops.test.ts))
  - **Security tests:** Symlink escape prevention, filesystem boundary enforcement (e.g., [src/**tests**/security/symlink-escape.test.ts](src/__tests__/security/symlink-escape.test.ts))
  - **Edge case tests:** Large files, truncation, empty results (e.g., [src/**tests**/lib/file-operations/search-content-edge-cases.test.ts](src/__tests__/lib/file-operations/search-content-edge-cases.test.ts))
  - **Mocks/Fixtures:** Tests use temporary directories (`os.tmpdir()`) and `setAllowedDirectoriesResolved()` to configure allowed paths (see [src/**tests**/tools/write-ops.test.ts](src/__tests__/tools/write-ops.test.ts))
  - **DB/Services:** No external services required; all tests are self-contained file operations.

## 7) Common Pitfalls

- **Pitfall:** Forgetting to check both requested path AND resolved path against allowed directories → **Fix:** Always use `validateExistingPath()` which implements the double-check pattern automatically (see [src/lib/path-validation.ts](src/lib/path-validation.ts) lines 517-554).
- **Pitfall:** Not propagating `AbortSignal` to nested async operations → **Fix:** Use `withAbort(signal, fs.promises.*)` wrapper from [src/lib/fs-helpers.ts](src/lib/fs-helpers.ts) to ensure native fs operations respect signals.
- **Pitfall:** Creating infinite async generator loops without abort checks → **Fix:** Call `assertNotAborted(signal)` at loop boundaries (see [src/lib/fs-helpers.ts](src/lib/fs-helpers.ts) `assertNotAborted`).
- **Pitfall:** Test failures due to test files being included in lint/typecheck → **Fix:** Tests are excluded via [tsconfig.json](tsconfig.json) `exclude` and [eslint.config.mjs](eslint.config.mjs) `ignores`.

## 8) Evolution Rules

- If conventions change, include an `AGENTS.md` update in the same PR.
- If a command is corrected after failures, record the final verified command here with evidence (file path + line number).
- If a new critical path or pattern is discovered, add it to the relevant section with evidence.
- If security patterns are enhanced (e.g., improved path validation), document the change in section 5 (Agent Behavioral Rules) and section 7 (Common Pitfalls).
