# AGENTS.md

> Purpose: High-signal context and strict guidelines for AI agents working in this repository.

## 1) Project Context

- **Domain:** Read-only MCP server for secure filesystem exploration (list/search/read/metadata) within explicitly allowed roots.
- **Tech Stack (Verified):**
  - **Languages:** TypeScript (see [tsconfig.json](tsconfig.json)); Node.js (see [package.json](package.json) `engines.node`).
  - **Frameworks/Runtime:** Model Context Protocol (MCP) TypeScript SDK over stdio (see [package.json](package.json) deps; [src/server.ts](src/server.ts) `StdioServerTransport`).
  - **Key Libraries:**
    - `@modelcontextprotocol/sdk` (see [package.json](package.json))
    - `zod` (see [package.json](package.json); schemas in [src/schemas.ts](src/schemas.ts))
    - `re2` + `safe-regex2` (see [package.json](package.json); used in [src/lib/file-operations/search-content.ts](src/lib/file-operations/search-content.ts))
    - `ignore` (see [package.json](package.json))
- **Architecture:** Single Node/TypeScript package; stdio MCP server that registers tools/resources and enforces root-based access control (see [src/index.ts](src/index.ts), [src/server.ts](src/server.ts), [src/tools.ts](src/tools.ts), [src/lib/path-validation.ts](src/lib/path-validation.ts)).

## 2) Repository Map (High-Level)

- [src/](src/): Runtime server implementation.
  - [src/index.ts](src/index.ts): CLI entrypoint + shutdown handling.
  - [src/server.ts](src/server.ts): MCP server creation, stdio transport, Roots protocol integration.
  - [src/tools.ts](src/tools.ts): Tool registration + tool response/error shaping + resource-link behavior.
  - [src/schemas.ts](src/schemas.ts): Zod input/output schemas and input validation.
  - [src/lib/](src/lib/): Filesystem ops, security/path validation, errors, observability, resource store.
- [src/**tests**/](src/__tests__/): Node’s built-in test runner tests (unit/integration).
- [node-tests/](node-tests/): Node test runner “dist-level” regression tests (executes compiled `dist/`).
- [scripts/](scripts/): Project scripts (if present).
- [docs/](docs/): Repo assets (e.g., logo).
  > Ignore generated/vendor dirs like [dist/](dist/), [node_modules/](node_modules/).

## 3) Operational Commands (Verified)

- **Environment:**
  - **Node version:** `>=22.17.0` (see [package.json](package.json) `engines.node`).
  - **Package manager:** npm + `package-lock.json` (see [package-lock.json](package-lock.json)).
- **Install:** `npm ci` (CI uses this in [.github/workflows/publish.yml](.github/workflows/publish.yml)).
- **Dev:** `npm run dev` (see [package.json](package.json)).
- **Test:**
  - `npm test` (see [package.json](package.json); runs `node --test --import tsx/esm "src/__tests__/**/*.test.ts"`).
  - `npm run test:dist` (see [package.json](package.json); builds then runs [node-tests/search-content-workers-dist.test.ts](node-tests/search-content-workers-dist.test.ts)).
- **Build:** `npm run build` (see [package.json](package.json)).
- **Lint/Format/Types:**
  - `npm run lint` (see [package.json](package.json); config in [eslint.config.mjs](eslint.config.mjs))
  - `npm run format` (see [package.json](package.json); config in [.prettierrc](.prettierrc))
  - `npm run type-check` (see [package.json](package.json))
- **Release pipeline (CI source of truth):** `npm ci` → `npm run lint` → `npm run type-check` → `npm run test` → `npm run build` (see [.github/workflows/publish.yml](.github/workflows/publish.yml)).

## 4) Coding Standards (Style & Patterns)

- **Module system:** ESM (`"type": "module"`) and TypeScript `NodeNext` (see [package.json](package.json), [tsconfig.json](tsconfig.json)).
- **Imports:** Local imports use `.js` extensions in TS sources (see [src/index.ts](src/index.ts)).
- **Typing/Strictness:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, etc. (see [tsconfig.json](tsconfig.json)).
- **Lint rules (high impact):**
  - Explicit function return types enforced (see [eslint.config.mjs](eslint.config.mjs) `@typescript-eslint/explicit-function-return-type`).
  - Type-only imports/exports enforced (see [eslint.config.mjs](eslint.config.mjs) `@typescript-eslint/consistent-type-imports`).
  - `any` is forbidden (see [eslint.config.mjs](eslint.config.mjs) `@typescript-eslint/no-explicit-any`).
- **Formatting:** Prettier with import sorting (see [.prettierrc](.prettierrc)).
- **Patterns observed:**
  - **Dual output for tools:** tool results include human text plus a JSON content block mirroring `structuredContent` (see [src/tools.ts](src/tools.ts) `buildToolResponse` / `buildToolErrorResponse`; tests in [src/**tests**/tools/tool-response.test.ts](src/__tests__/tools/tool-response.test.ts)).
  - **Security boundary:** all filesystem access is restricted to allowed roots and normalized paths; Windows-reserved device names and null bytes are rejected (see [src/server.ts](src/server.ts) CLI validation; [src/lib/path-validation.ts](src/lib/path-validation.ts)).
  - **Regex safety:** content search uses RE2 + safe-regex validation for ReDoS resistance (see [src/lib/file-operations/search-content.ts](src/lib/file-operations/search-content.ts)).

## 5) Agent Behavioral Rules (Do Nots)

- Do not introduce new dependencies without updating [package.json](package.json) and [package-lock.json](package-lock.json) via npm.
- Do not edit [package-lock.json](package-lock.json) manually.
- Do not write non-protocol output to stdout in runtime paths (stdio MCP); use stderr/logging instead (see [src/index.ts](src/index.ts) uses `console.error`, and the server uses `StdioServerTransport` in [src/server.ts](src/server.ts)).
  - Exception: tests may intentionally write JSON to stdout for harnessing (see [node-tests/search-content-workers-dist.test.ts](node-tests/search-content-workers-dist.test.ts)).
- Do not weaken path/roots security checks (allowed roots, symlink escapes, reserved names) without adding tests in [src/**tests**/security/](src/__tests__/security/).
- Do not read, print, or commit token/secret files (repo contains files named `.mcpregistry_*_token` in the root).
- Do not disable or bypass existing ESLint/TypeScript rules without explicit approval.

## 6) Testing Strategy (Verified)

- **Framework:** Node built-in test runner (`node --test`) with TS execution via `tsx/esm` (see [package.json](package.json) scripts).
- **Where tests live:**
  - Unit/integration: [src/**tests**/](src/__tests__/)
  - Dist regression: [node-tests/](node-tests/) (see [package.json](package.json) `test:dist`).
- **Approach:**
  - Schema defaults and strict input validation (unknown keys rejected) are tested (see [src/**tests**/tools/tool-defaults.test.ts](src/__tests__/tools/tool-defaults.test.ts)).
  - Error and tool response shapes are tested (see [src/**tests**/tools/tool-response.test.ts](src/__tests__/tools/tool-response.test.ts)).
  - Worker-path behavior is validated against built `dist/` (see [node-tests/search-content-workers-dist.test.ts](node-tests/search-content-workers-dist.test.ts)).

## 7) Common Pitfalls (Verified Only)

- Node runtime version alignment: CI uses Node 22.17.0 to match the package engine `>=22.17.0` (see [.github/workflows/publish.yml](.github/workflows/publish.yml) and [package.json](package.json)). Validate runtime API changes under that engine.
- Tools may return `E_ACCESS_DENIED` until roots are configured (see [src/**tests**/tools/tool-defaults.test.ts](src/__tests__/tools/tool-defaults.test.ts) and root/roots logic in [src/server.ts](src/server.ts)).
- `head` cannot be combined with `startLine`/`endLine` for reads (enforced in [src/schemas.ts](src/schemas.ts)).

## 8) Evolution Rules

- If conventions change, include an `AGENTS.md` update in the same PR.
- If a command is corrected after failures, record the final verified command here.
