# AGENTS.md

> Purpose: High-signal context and strict guidelines for AI agents working in this repository.

## 1) Project Context

- **Domain:** MCP server for secure local filesystem navigation, search, metadata, and file operations for LLM/tooling clients (see `package.json`, `README.md`, `src/tools.ts`).
- **Tech Stack (Verified):**
  - **Languages:** TypeScript (see `package.json`, `tsconfig.json`, `src/**/*.ts`).
  - **Frameworks:** MCP server stack via `@modelcontextprotocol/sdk` and Zod schemas (see `package.json`, `src/server.ts`, `src/schemas.ts`).
  - **Key Libraries:** `@modelcontextprotocol/sdk`, `zod`, `commander`, `re2`, `diff` (see `package.json`).
- **Architecture:** Single-package Node ESM TypeScript server with a composed registration layer (`src/server.ts`), per-tool modules (`src/tools/*.ts`), shared filesystem/security utilities (`src/lib/*`), and prompt/resource registration (`src/prompts.ts`, `src/resources.ts`) (see `package.json`, `src/server.ts`, `src/tools.ts`).

## 2) Repository Map (High-Level)

- `src/`: Main server implementation, tool registration, schemas, and shared libraries (see `src/index.ts`, `src/server.ts`, `src/tools.ts`, `src/lib/`).
- `src/__tests__/`: Primary automated tests split by area (`integration`, `lib`, `tools`, `security`, `server`) (see `src/__tests__/`).
- `scripts/`: Build/test task orchestration for compile, type-check, and tests (see `scripts/tasks.mjs`).
- `.github/workflows/`: CI/CD and release automation (see `.github/workflows/release.yml`).
- `node-tests/`: Additional Node-level test files (see `node-tests/*.test.ts`).
  > Ignore generated/vendor dirs like `dist/`, `build/`, `node_modules/`, `.venv/`, `__pycache__/`.

## 3) Operational Commands (Verified)

- **Environment:** Node.js `>=24` and npm (see `package.json#engines`, `.github/workflows/release.yml` `actions/setup-node@v4` with `node-version: '24'`).
- **Install:** `npm ci` (see `.github/workflows/release.yml`, `README.md`).
- **Dev:** `npm run dev` (see `package.json` `scripts.dev`; note CI does not run a watch/dev loop).
- **Test:** `npm run test` (see `.github/workflows/release.yml`, `package.json` `scripts.test`); targeted fast runner: `npm run test:fast` (see `package.json`).
- **Build:** `npm run build` (see `.github/workflows/release.yml`, `package.json`, `scripts/tasks.mjs`).
- **Lint/Format:** `npm run lint` (see `.github/workflows/release.yml`, `package.json`); `npm run format` (see `package.json`).

## 4) Coding Standards (Style & Patterns)

- **Naming:** Enforced TypeScript naming conventions: camelCase defaults, PascalCase for type-like symbols, and allowed UPPER_CASE for constants/enum members (see `eslint.config.mjs` `@typescript-eslint/naming-convention`).
- **Structure:** Entrypoint handles CLI and lifecycle (`src/index.ts`), server composes capabilities/resources/prompts/tools (`src/server.ts`), and tools are registered centrally through `registerAllTools` (`src/tools.ts`).
- **Typing/Strictness:** Strict TypeScript enabled with `strict`, `noUncheckedIndexedAccess`, `isolatedModules`, `verbatimModuleSyntax`, and exact optional property semantics (see `tsconfig.json`).
- **Patterns Observed:**
  - Tool-level modular registration pattern with one registrar per tool and centralized registry fan-out (observed in `src/tools.ts`).
  - Defensive path-security policy with deny/allow glob matching and explicit access-denied errors for sensitive paths (observed in `src/lib/path-policy.ts`).
  - Normalized error classification and user-facing suggestions mapped from Node/system errors to MCP error codes (observed in `src/lib/errors.ts`).
  - Task-capable tool integration and progress reporting for long-running operations (observed in `src/tools/search-content.ts`, `src/tools/task-support.ts`).

## 5) Agent Behavioral Rules (Do Nots)

- Do not introduce new dependencies without updating `package.json` and lockfile through npm workflows (see `package.json`, `package-lock.json`, `.github/workflows/release.yml`).
- Do not edit lockfiles manually (lockfile is generated in release flow via npm and committed as an artifact) (see `.github/workflows/release.yml` step `npm install --package-lock-only --ignore-scripts`).
- Do not commit secrets; never print `.env` values; use existing CI secret mechanisms (`GITHUB_TOKEN`) where applicable (see `.github/workflows/release.yml`, `package.json` `scripts.dev:run` with `--env-file=.env`).
- Do not change tool contracts/capabilities without updating tests and documentation (tool surface is asserted in protocol e2e tests and documented in README) (see `src/__tests__/integration/mcp-protocol-e2e.test.ts`, `README.md`, `src/server.ts`, `src/tools.ts`).
- Do not disable or bypass existing lint/type rules without explicit approval (see `eslint.config.mjs`, `tsconfig.json`).

## 6) Testing Strategy (Verified)

- **Framework:** Node test runner (`node --test`) with TypeScript execution via `tsx/esm` when needed (see `package.json` `scripts.test:fast`, `scripts/tasks.mjs`, and `import { it, describe } from 'node:test'` in tests).
- **Where tests live:** `src/__tests__/...` (integration/lib/tools/security/server) and `node-tests/` (see directory structure and files under those paths).
- **Approach:**
  - Protocol-level integration/e2e validates full MCP surface through SDK client sessions over stdio (see `src/__tests__/integration/mcp-protocol-e2e.test.ts`).
  - Unit/behavior tests validate library and tool-specific edge cases (see `src/__tests__/lib/**/*`, `src/__tests__/tools/**/*`).
  - Worker/thread behavior and consistency checks are exercised with compiled-path test harnesses and env-driven worker counts (see `src/__tests__/lib/file-operations/search-content-workers.test.ts`).

## 7) Common Pitfalls (Optional; Verified Only)

- Accessing paths outside allowed roots or sensitive files is blocked by policy and mapped to explicit access errors → always resolve within allowed directories first (see `src/lib/path-validation.ts`, `src/lib/path-policy.ts`, `src/__tests__/security/filesystem-boundary.test.ts`).
- Large result payloads can be truncated/externalized into resource links → handle `resource_link`/resource reads for full output (see `src/tools/search-content.ts`, `README.md` resources section).

## 8) Evolution Rules

- If conventions change, include an `AGENTS.md` update in the same PR.
- If a command is corrected after failures, record the final verified command here.
- If a new critical path or pattern is discovered, add it to the relevant section with evidence.
