# AGENTS.md — working on GameX Engine

Rules for any coding agent (Claude Code, Codex, Cursor, …) working **on this repository**.
`CLAUDE.md` is a shim that points here. Product brief: `docs/MASTER_PROMPT.md` (read "GameSpec" as
GameX Engine). Design: `docs/ARCHITECTURE.md`. Plan and phase status: `docs/PLAN.md`. Decisions:
`docs/DECISIONS/`.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm install` | Install (Node ≥ 22.18, pnpm 10 via Corepack). |
| `pnpm build` | Build every package (`tsc -b`), the CLI bundle (`tsup`) and the studio (`vite build`). |
| `pnpm typecheck` | Type-check sources **and tests** of every package. Needs dependencies built (turbo does it). |
| `pnpm test` | Vitest in every package, with coverage (≥ 85 % enforced for `model` and `engine`). |
| `pnpm lint` | ESLint (type-aware, zero warnings) + Prettier check. `pnpm format` fixes formatting. |
| `pnpm depcruise` | Architecture rules (no cycles, pure core, declared deps). Run after `pnpm build`. |
| `pnpm check` | Everything above, in CI order. |
| `pnpm --filter @gamex/<pkg> test` | One package. |
| `node packages/cli/dist/gamex.js doctor --json` | Run the built CLI. |

**Definition of done:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm depcruise` pass
from a clean checkout, and the change has tests that would fail without it.

## Layout

```
packages/model     @gamex/model     Zod schemas, ids/keys, expression language, validation   (PURE)
packages/engine    @gamex/engine    PRNG, rule interpreter, simulation, exploration          (PURE)
packages/ingest    @gamex/ingest    SafeFileSystem, deny-list, readers, chunking
packages/extract   @gamex/extract   LlmProvider, extraction passes, merge, gaps
packages/specpack  @gamex/specpack  Spec Pack renderers (pure) + writer
packages/drift     @gamex/drift     Drift detection
packages/cli       @gamex/cli       `gamex` binary
apps/studio        @gamex/studio    Vite + React studio
fixtures/          @gamex/fixtures  Swarm Rescue GDD, sample repo, fixture tests
tooling/           shared Vitest config
```

## Non-negotiable rules

1. **One canonical Game Model.** Every feature reads a `GameModel` from `@gamex/model`. Nothing bypasses it.
2. **The LLM proposes; deterministic code decides.** No LLM output is ever used as a number, a simulation
   result, or a golden-test expectation.
3. **`model` and `engine` are pure.** No I/O, no `node:*`, no `process`, no clock, no `Math.random`, no
   `Math.exp/log/pow/sin/…`, no `**`. ESLint and dependency-cruiser enforce this; do not disable the rules —
   use the seeded PRNG and the deterministic math module, and take time as an input.
4. **Determinism.** Same model + same seed ⇒ byte-identical output in Node and browsers, regardless of worker count.
5. **Provenance on every model node**; nothing is simulated or exported without review.
6. **Repo safety.** Target-repo files are read only through `@gamex/ingest`. Never weaken the deny-list
   (`packages/ingest/src/deny-list.ts`) to make a test pass. `fixtures/swarm-rescue/sample-repo/.env` is a
   planted canary, not a secret.
7. **Spec Pack writes** stay inside `gamex/`, the delimited `AGENTS.md` block, and create-if-missing shims.

## Conventions

- TypeScript strict (+ `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESM only, `.js` suffix on
  relative imports in packages.
- Tests live in `<pkg>/test/*.test.ts` and import the package by name (`@gamex/model`); Vitest aliases those
  to `src/` so no build is needed for tests.
- Property-based tests (`fast-check`) for anything in `model`/`engine` with an algebraic property.
- Errors are actionable: what failed, where (file/line/JSON path/node id), how to fix it.
- Every CLI command supports `--json` (one JSON document on stdout; human output on stderr). Exit codes:
  0 ok, 1 findings/validation failure, 2 usage error, 3 I/O or LLM error.
- Ids are kebab-case; keys (used in expressions, balance files, golden tests) are derived camelCase (`idToKey`).

## Process

- Work phase by phase (`docs/PLAN.md`); stop and report at the end of each phase.
- Non-trivial choices get an ADR in `docs/DECISIONS/NNNN-title.md`.
- Ask the maintainer before changing the Game Model schema, the Spec Pack format, or anything written into a user's repo.
- Conventional commits (`feat(engine): …`, `test(model): …`, `docs: …`), small and often. Never commit secrets. Never force-push.
- Keep this file current when commands or conventions change.
