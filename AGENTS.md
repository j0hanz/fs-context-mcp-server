# AGENTS.md

> Purpose: High-signal context and strict guidelines for AI agents working in this repository.

## 1) Project Context

- **Domain:** Read-only Model Context Protocol (MCP) server for secure filesystem exploration and analysis.
- **Tech Stack (Verified):**
  - **Languages:** TypeScript 5.9+ (evidence: `package.json`, `tsconfig.json`)
  - **Runtime:** Node.js >=22.19.8 (evidence: `package.json` engines)
  - **Frameworks:** Model Context Protocol SDK (evidence: `package.json` dependency `@modelcontextprotocol/sdk`)
  - **Key Libraries:** `zod` (validation), `re2` (safe regex), `ignore` (file filtering) (evidence: `package.json`)
- **Architecture:** MCP Server with tool-based architecture; custom build/task system in `scripts/tasks.mjs`. (evidence: `src/server.ts`, `scripts/tasks.mjs`)

## 2) Repository Map (High-Level)

- `src/`: Core source code (evidence: `tsconfig.json`)
- `src/tools/`: MCP Tool implementations (evidence: `src/tools`)
- `src/__tests__/`: Unit tests (evidence: `src/__tests__`, `scripts/tasks.mjs`)
- `scripts/`: Build and maintenance task scripts (evidence: `package.json` scripts)
- `node-tests/`: Additional integration/node-specific tests (evidence: `node-tests` folder)
- `docs/`: Documentation (evidence: `docs` folder)
  > Ignore generated/vendor dirs like `dist/`, `node_modules/`, `coverage/`.

## 3) Operational Commands (Verified)

- **Environment:** Node.js (evidence: `package.json`)
- **Install:** `npm ci` (evidence: `.github/workflows/publish.yml`)
- **Dev:** `npm run dev` (runs `tsc --watch`) (evidence: `package.json`)
- **Test:** `npm run test` (runs `node scripts/tasks.mjs test`) (evidence: `package.json`)
- **Build:** `npm run build` (runs `node scripts/tasks.mjs build`) (evidence: `package.json`)
- **Lint/Format:** `npm run lint` (ESLint) / `npm run format` (Prettier) (evidence: `package.json`)
- **Type Check:** `npm run type-check` (evidence: `package.json`)

## 4) Coding Standards (Style & Patterns)

- **Naming:** CamelCase default; PascalCase for types/classes. Strict naming rules enforced by ESLint. (evidence: `eslint.config.mjs`)
- **Structure:**
  - Entry point: `src/index.ts`
  - Server setup: `src/server.ts`
  - Tools defined in `src/tools/`
- **Typing/Strictness:** TypeScript `strict: true`, `noImplicitAny`, and `tseslint.configs.strictTypeChecked` are enforced. (evidence: `tsconfig.json`, `eslint.config.mjs`)
- **Patterns Observed:**
  - **Custom Task Runner:** Uses `scripts/tasks.mjs` for orchestration instead of complex npm scripts. (evidence: `package.json`, `scripts/tasks.mjs`)
  - **Strict Linting:** `no-explicit-any`, `explicit-function-return-type` are errors. (evidence: `eslint.config.mjs`)

## 5) Agent Behavioral Rules (Do Nots)

- Do not introduce new dependencies without updating `package.json` and `package-lock.json` via npm. (evidence: `package.json`)
- Do not edit `package-lock.json` manually. (evidence: standard npm practice)
- Do not commit secrets; never print `.env` values. (evidence: general security practice)
- Do not disable or bypass existing lint/typecheck rules (e.g., `eslint-disable`) without explicit approval. (evidence: `eslint.config.mjs` strictness)
- Do not use `any` type; use `unknown` or specific types (enforced by linter). (evidence: `eslint.config.mjs`)

## 6) Testing Strategy (Verified)

- **Framework:** Node.js native test runner (`node --test`). (evidence: `scripts/tasks.mjs`)
- **Where tests live:** `src/__tests__` and `node-tests`. (evidence: `scripts/tasks.mjs` config, filesystem)
- **Approach:**
  - Unit tests in `src/__tests__/*.test.ts`
  - Tests run via `scripts/tasks.mjs` wrapper.

## 7) Common Pitfalls (Optional; Verified Only)

- **Test Pattern Matching:** The test runner in `scripts/tasks.mjs` looks for `src/__tests__/**/*.test.ts` and `tests/**/*.test.ts`. If you add tests elsewhere, they may not run. (evidence: `scripts/tasks.mjs`)
- **Strict TypeScript:** The codebase is very strict. Expect type errors for implicit any or missing return types. (evidence: `eslint.config.mjs`)

## 8) Evolution Rules

- If conventions change, include an `AGENTS.md` update in the same PR.
- If a command is corrected after failures, record the final verified command here.
