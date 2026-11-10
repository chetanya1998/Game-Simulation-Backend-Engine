# ADR 0003 — Phase 0 tooling details

- Status: Accepted
- Date: 2026-11-10

## Decisions

1. **TypeScript 6.0.x, not 7.** TypeScript 7 (the native port) is the npm `latest`, but typescript-eslint
   supports `<6.1`, and type-aware linting is part of our quality bar. We pin `~6.0.3` and revisit when
   typescript-eslint supports 7.
2. **Package resolution.** Packages export `dist/` through `package.json` `exports`. Builds and
   type-checks resolve workspace packages through those exports (turbo builds dependencies first).
   Tests use a Vitest alias (`tooling/vitest.shared.ts`) to import `src/` directly, so `pnpm test` needs no build.
3. **Two tsconfigs per package.** `tsconfig.build.json` (sources only, emits, project references) and
   `tsconfig.json` (sources + tests, no emit) which is also what type-aware ESLint uses.
4. **Determinism is linted.** In `model`/`engine`: `Math.random`, approximated `Math.*` functions, `**`,
   clock reads, `process`, and Node/I/O imports are ESLint errors.
5. **Architecture is checked by dependency-cruiser** after build: no cycles, pure core, `model` is the root,
   `specpack`/`studio` cannot reach LLM or I/O packages, nothing imports the CLI, and every import must
   resolve to a declared dependency.
6. **The CLI bundles workspace packages** with tsup into `dist/gamex.js`; third-party deps stay external.
7. **Usage errors exit with code 2**, `--json` envelopes are `{ ok, command, data, issues }` (first used by
   `gamex doctor`).
8. **Studio tests render with `react-dom/server`** for now (no DOM emulation); Phase 5 adds Playwright.
