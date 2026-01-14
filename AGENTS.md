# AGENTS.md

> **Purpose:** Context and strict guidelines for AI agents working in this repository.

## 1. Project Context

- **Domain:** Read-only MCP server for secure filesystem exploration, searching, and analysis.
- **Tech Stack:**
  - **Language:** TypeScript 5.9.3 (Node.js >= 22.17.0)
  - **Framework:** Model Context Protocol SDK 1.25.x (`@modelcontextprotocol/sdk`)
  - **Key Libraries:** `zod`, `ignore`, `re2`
- **Architecture:** Layered server + tool registry + lib/file-operations.

## 2. Repository Map (High-Level Only)

- `src/`: Server entrypoint, tool registration, schemas, and core logic.
- `src/lib/`: File operations, path validation, errors, observability.
- `src/__tests__/`: Node test runner unit/integration tests with fixtures.
- `node-tests/`: Dist/Node runtime tests.
- `docs/`: Project assets and documentation.
  > _Note: Ignore `dist`, `node_modules`, `.venv`, and `__pycache__`._

## 3. Operational Commands

- **Environment:** Node.js >= 22.17.0
- **Install:** `npm install`
- **Dev Server:** `npm run dev`
- **Test:** `npm run test` (prefer targeted tests)
- **Build:** `npm run build`

## 4. Coding Standards (Style & Patterns)

- **Naming:** `camelCase` for variables/functions, `PascalCase` for types/classes.
- **Structure:** Keep tool registration in `src/tools.ts`; keep filesystem logic under `src/lib/file-operations/`.
- **Typing:** Strict TypeScript; use `import type` for type-only imports.
- **Preferred Patterns:**
  - Tool handlers return both human-readable `content` and `structuredContent` JSON.
  - Use Zod schemas for tool input/output validation.
  - Use `.js` extensions in local imports (NodeNext).

## 5. Agent Behavioral Rules (The "Do Nots")

- **Prohibited:** Do not add default exports; use named exports only.
- **Prohibited:** Do not omit `.js` extensions in local imports.
- **Prohibited:** Do not edit lockfiles manually.
- **Handling Secrets:** Never output `.env` values or hardcode secrets.
- **File Creation:** Always verify folder existence before creating files.

## 6. Testing Strategy

- **Framework:** Node.js test runner (`node --test` via npm scripts).
- **Approach:** Unit/integration tests in `src/__tests__` with fixtures; runtime verification tests in `node-tests`.

## 7. Evolution & Maintenance

- **Update Rule:** If a convention changes or a new pattern is established, the agent MUST suggest an update to this file in the PR.
- **Feedback Loop:** If a build command fails twice, the correct fix MUST be recorded in the "Common Pitfalls" section.
- **Common Pitfalls:** None recorded yet.
