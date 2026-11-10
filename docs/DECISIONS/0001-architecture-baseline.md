# ADR 0001 — Architecture baseline

- Status: Proposed (awaiting approval together with `docs/PLAN.md`)
- Date: 2026-11-10

## Context

The master prompt (`docs/MASTER_PROMPT.md`) fixes the product principles and a default stack. Before any
code, we need to agree on the boundaries that are expensive to change later: package graph, the purity of
`model`/`engine`, how determinism is guaranteed, and how the Spec Pack avoids clobbering user edits.

## Decision

1. **TypeScript monorepo** (pnpm 10 + Turborepo, Node ≥ 22.18, ESM-only, strict TS). Libraries build with
   `tsc -b`; CLI bundled with `tsup`; studio with Vite.
2. **Pure core.** `@gamespec/model` and `@gamespec/engine` have no I/O, no `node:*` imports, no LLM SDK,
   enforced by ESLint and dependency-cruiser in CI.
3. **Single enforcement path.** One rule interpreter (`engine.step`) drives simulation, exploit search,
   golden-test generation, and the reference runner shipped in the Spec Pack.
4. **Determinism across runtimes.** `sfc32` PRNG with hashed stream splitting per (seed, persona, player,
   purpose); only exactly-specified float operations plus in-house `log`/`exp`; integer resources; canonical
   JSON output. Same model + seed ⇒ byte-identical output in Node and browsers, independent of worker count.
5. **Zod 4 as schema source of truth**, using its native `z.toJSONSchema()` instead of `zod-to-json-schema`.
6. **Spec Pack = pure render + guarded write.** `renderSpecPack()` returns a `FileMap` with ownership classes
   (`generated | section | create-if-missing | editable-seeded`); the Node writer plans, detects conflicts
   via a lock file of last-written hashes, and writes atomically.
7. **LLM behind `LlmProvider`**, Anthropic SDK with structured outputs as the first implementation; provenance
   is computed and verified by our code, never trusted from the model.

## Consequences

- Designers' expressions and curves evaluate identically in the studio, CLI, CI and the shipped reference runner.
- Some convenience is lost (no `Math.pow/log/exp` in model/engine code); covered by a small tested math module.
- The interpreter becomes the most critical module; it gets the heaviest property-based testing.
- Open points that affect schema/pack format are listed as clarifying questions in `docs/PLAN.md` and will
  get their own ADRs once answered.
