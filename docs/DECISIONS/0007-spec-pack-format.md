# ADR 0007 — Spec Pack format 0.1

- Status: Accepted (Phase 3) — open to revision; the format is what coding agents and backends build against
- Date: 2026-11-17

## Decisions

1. **Source of truth in the target repo is `gamex/game-model.json`** (canonical JSON, with `$schema` pointing at
   `schema/game-model.schema.json`). Every other file is generated from it by `gamex sync`; `$schema` is ignored
   by the content hash.
2. **Ownership classes** decide how the writer treats each file: `generated` (hand edits are conflicts),
   `editable` (generated, but `<!-- GAMEX:EDITABLE name -->` regions keep the user's text — RULES.md, tasks),
   `section` (only the `<!-- GAMEX:BEGIN v1 -->…<!-- GAMEX:END -->` block of AGENTS.md), `create-if-missing`
   (CLAUDE.md, GEMINI.md shims), `source` (the model, always canonicalized).
3. **Lock file** `gamex/.gamex-lock.json` stores the SHA-256 of the managed part of every file GameX wrote. A file
   whose managed part differs from the lock (or that exists without a lock entry) is a conflict; with any conflict
   nothing is written unless `--force`. Files GameX no longer produces are deleted only if unmodified.
4. **Writes** go only to `gamex/**`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`; never through symlinks; via temp file +
   rename. No timestamps or absolute paths in generated content, fixed ordering ⇒ `sync` twice changes nothing.
5. **Golden tests**: one file per action/placement, `tests/golden/<kind>-<id>.json` = `{ $comment, subject, cases }`.
   A case is `{ id, rule, description, given: { state, prevState?, now?, persona?, vars }, when, then }` with
   `when` = `{ action, outcome? }` or `{ placement }` and `then` = `{ result, error?, outcome?, deltas, impressions? }`
   or `{ eligible, reason? }`. `given.vars` lists only values that differ from initial values. Cases come from
   accepted runs (one per outcome), boundary values of every limit/cooldown/cost, one falsified case per
   precondition/rule/eligibility condition, a forbidden-screen case per UI placement, and states along the
   witness paths. Every `then` is computed by the engine.
6. **Reference runner** `tests/runner/interpreter.ts` + `run-golden.ts`: an independent, zero-dependency TypeScript
   implementation of the rule semantics (ADR 0006) for plain `node` ≥ 22.18 (erasable syntax only). CI checks it
   agrees with the engine on every case, and that changing a rule makes the affected cases fail.
7. **Backend contract**: OpenAPI 3.1 with one `POST /players/{playerId}/actions/<action-id>` per action (required
   `Idempotency-Key`; `outcome` for actions with outcomes, `adVerification` for rewarded, `receipt` for store
   actions; 409 with the action's exact error-code enum), eligibility `GET` per screen placement, `GET` state and
   balance. PostgreSQL data model with checks that mirror the model (resource caps, enum values, ranges), unique
   SSV tokens and receipts, idempotency keys, and one state table per variable scope.
8. **Balance files** `balance/<balanceFile>.json` = `{ $comment, file, values, curves, meta }` keyed by constant key.
9. **Report** `reports/latest-sim.md` uses seed/days/players from the CLI (defaults 1/7/100); sensitivity only with
   `--sensitivity`. `reports/drift.md` is written by `gamex drift` (Phase 6).
