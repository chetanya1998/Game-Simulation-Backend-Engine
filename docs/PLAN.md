# GameSpec Studio — Phase Plan

> Status: **DRAFT — awaiting approval.** Read alongside [`ARCHITECTURE.md`](./ARCHITECTURE.md).
> Each phase ends with a stop-and-report (what was built, how to run it, actual test output, known
> limitations, next). Nothing in phase N+1 starts before "continue".

## Stack check

The default stack in the master prompt holds up; I'm keeping it with these specifics (ADR 0001):

| Area | Choice | Note |
|---|---|---|
| Runtime | Node 22 LTS (`engines: >=22.18`), pnpm 10 via Corepack | 22.18+ runs `.ts` natively (type stripping), which the Spec Pack runner relies on. |
| Build | `tsc -b` project references for libs; `tsup` bundle for the CLI; Vite for studio | Keeps `.d.ts` emission simple, single-file CLI. |
| Orchestration | Turborepo | `lint`, `typecheck`, `test`, `build` pipelines with caching. |
| Schema | Zod 4 + `z.toJSONSchema()` | Zod 4 ships native JSON Schema export, so the `zod-to-json-schema` dependency is unnecessary. (Will fall back to it if a gap shows up.) |
| CLI | `commander` | Mature, typed, subcommands. |
| Charts | ECharts | Better than Recharts for box plots, histograms and tornado charts; canvas rendering handles large series. |
| Graph layout | React Flow + ELK.js | Auto-layout of 22-state machine and economy graph. |
| Worker RPC | Comlink | |
| PDF | `unpdf` | Per-page text, small, works in Node. |
| Arch checks | `dependency-cruiser` | Enforces "engine has no I/O / no extract import", no cycles. |
| LLM | `@anthropic-ai/sdk`, structured outputs + Zod, default model `claude-opus-5-5` | Behind `LlmProvider`. |

## Phases

### Phase 0 — Foundation (≈ 1 session)

Deliverables
- pnpm workspace + Turborepo; `tooling/` shared `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, ESM), ESLint flat config (typescript-eslint, determinism bans for
  `model`/`engine`), Prettier, Vitest workspace with coverage.
- Empty-but-real packages (`model, engine, ingest, extract, specpack, drift, cli`) and `apps/studio`
  skeleton, each with one meaningful test (e.g. package exports resolve; `gamespec --version` prints the version).
- `dependency-cruiser` rules (no cycles; `model`/`engine` cannot import `node:*`, `ingest`, `extract`, LLM SDKs).
- `.github/workflows/ci.yml`: install (frozen lockfile) → lint → typecheck → test → build → depcruise.
- `AGENTS.md` (commands, conventions, rules) + `CLAUDE.md` shim; `docs/DECISIONS/0001…`.
- `fixtures/swarm-rescue/GDD.md` (full GDD-style document, numbers marked `[ASSUMED]` where not given),
  `fixtures/swarm-rescue/sample-repo/` (README + a tiny config dir + a planted `.env` for later tests).

Acceptance: `pnpm install && pnpm lint && pnpm test && pnpm build` pass on a clean clone; CI green.

### Phase 1 — Game Model (≈ 2–3 sessions)

Deliverables
1. Zod schemas for every section (§3 of ARCHITECTURE), `NodeBase` + `Provenance`, typed refs.
2. Expression language: lexer, Pratt parser with spans, printer, type checker, evaluator, located errors with "did you mean".
3. Curves: `evalCurve` + tests (incl. exact integer geometric powering, rounding modes).
4. Normalizer: desugar cooldowns/limits into implicit vars + rules; derive `key` from `id`.
5. `validateGameModel()` layers 1–6 with `Issue` objects, JSON source map → file/line.
6. Canonical JSON writer + content hash; `schemaVersion` + migration scaffold.
7. JSON Schema generation script → `packages/model/schema/game-model.schema.json` (checked in, CI verifies it's up to date).
8. Hand-written `fixtures/swarm-rescue/swarm-rescue.game-model.json` (22 states, all placements, rules, personas, invariants, gaps).

Tests / acceptance
- Fixture validates with zero errors.
- A corpus of ≥ 25 deliberately broken models, each asserting the exact `code`, `path`, and line.
- fast-check properties: parse∘print = id; evaluator agrees with an oracle; well-typed ⇒ no throw; determinism.
- Coverage ≥ 85 % for `model`.

### Phase 2 — Engine (≈ 3–4 sessions)

Deliverables
1. `sfc32` + `splitmix32` + stream derivation; deterministic math (`dlog`, `dexp`) + distributions.
2. Rule interpreter `step()` (the single enforcement path).
3. Reachability: graph analysis, SCC traps, interval-based never-true guards, bounded concrete exploration with witnesses.
4. Monte Carlo: clock, days/sessions, persona policy, outcomes, churn hazard, KPIs, quantiles, sampled traces, `RunRecord`.
5. Sweeps (grid, LHS) with common random numbers; OAT sensitivity → tornado data.
6. Exploit search (greedy + beam + restarts), static reward-loop detection on the flow graph, delta-debugged repro sequences.
7. Invariant evaluation with counterexample evidence.

Tests / acceptance
- Determinism: same seed ⇒ identical output hash; different worker chunkings ⇒ identical hash; (browser-worker check added to CI with Playwright).
- Reachability finds each seeded defect in `engine/test/models/broken-flow.json` (unreachable, dead end, trap, never-true guard).
- Exploit search finds a planted infinite-reward loop (e.g. rewarded "double" that can be claimed repeatedly) and returns a ≤ 5-step repro.
- Swarm Rescue: all interstitial invariants pass over the full sim; static check shows no interstitial eligibility in forbidden states.
- Statistical sanity tests for distributions (mean/variance within tolerance for fixed seeds).
- Coverage ≥ 85 % for `engine`.

### Phase 3 — Spec Pack + CLI (≈ 2–3 sessions)

Deliverables
1. Pure renderers for every file in master-prompt §9; `FileMap` with ownership classes.
2. Golden-test generator (boundary values from rules/limits/cooldowns/eligibility + trace-sampled accepted paths).
3. Reference runner (`gamespec/tests/runner/*.ts`, zero deps) emitted into the pack.
4. `AGENTS.md` section manager (markers, preserve outside content), shims, `SKILL.md` files, task generator.
5. OpenAPI 3.1 + SQL renderers; `FORMULAS.md` + `reference.ts`; `STATE_MACHINE.md` with Mermaid; `latest-sim.md`.
6. Writer: plan / conflicts / atomic writes / lock file.
7. CLI: `validate`, `sim`, `explore`, `sync` (`--json` everywhere, exit codes).

Tests / acceptance
- `sync` twice on the fixture repo ⇒ `git diff --exit-code` clean.
- All generated JSON validates against the generated JSON Schema; `openapi.yaml` passes an OpenAPI validator.
- `node gamespec/tests/runner/run-golden.ts` passes all golden cases in the generated pack (run in CI from a temp dir).
- Mutating one rule in the model makes the corresponding golden cases fail against the old runner (proves tests have teeth).
- Existing user content in `AGENTS.md` preserved byte-for-byte; editable regions preserved; hand-edits to generated files reported as conflicts.

### Phase 4 — Ingestion & extraction (≈ 3 sessions)

Deliverables
1. `SafeFileSystem` (gitignore, deny-list, content secret scan, allowlist, size cap, symlink policy).
2. Discovery heuristics + `IngestPlan` confirmation; readers (md, txt, pdf, json, yaml, toml, Unity `.asset`, C#, GDScript, TS) → located chunks.
3. `LlmProvider`, `AnthropicProvider`, `MockProvider`, `RecordingProvider`.
4. Passes A–D with Zod validation + 2 retries; provenance verification of excerpts.
5. Deterministic merge/dedupe, alias table, conflicts → `alternatives` + drift candidates; deterministic gap rules.
6. Review ledger + `gamespec review` (interactive + `--decisions`); `ingest`, `extract`, `init` end to end.

Tests / acceptance
- Planted `.env`, `id_rsa`, `*.pem`, high-entropy token file: never read into a chunk, never in any provider request (asserted on the mock's captured requests).
- With recorded fixtures: extraction recovers all Swarm Rescue placements (rewarded ×5, interstitial, banners, MREC) and the interstitial/revive rules with provenance pointing to the right GDD lines; the expected gaps (web build, COPPA, mediation, IAP, amounts/costs) are reported.
- `init --yes --decisions accept-all.json` on the sample repo produces a valid model and a complete Spec Pack.
- One opt-in live test (`GAMESPEC_LIVE=1`) against the real API.

### Phase 5 — Studio (≈ 4–5 sessions)

Deliverables: `gamespec studio` local server + views 1–10, Worker pool, light/dark mode, static-offline mode.

Acceptance: Playwright E2E — upload GDD → review (approve all) → change a constant slider → run → compare
A vs B → write Spec Pack — without touching the CLI; worker results hash-equal to CLI results; both themes
screenshot-tested; offline (network-blocked) except extraction.

### Phase 6 — Drift & CI template (≈ 2 sessions)

Deliverables: binding map, deterministic scanners (JSON/YAML/TOML/.asset/C#/GDScript/TS constants), optional
LLM fallback, classification, `reports/drift.md`, `gamespec drift` exit codes, `gamespec/ci/gamespec.yml`
GitHub Action template (validate + drift + quick sim + PR summary comment).

Acceptance: sample repo with code allowing 3 revives ⇒ `value-mismatch`/`rule-violation` reported with
file:line, non-zero exit; the Action template runs green on a clean sample repo in CI (via `act` or a workflow test job).

### Phase 7 — MCP server & Git app (later)

MCP server (official TS SDK) with read-only model queries and `sim`/`explore` tools; PR-based delivery.
Planned in detail when we get there.

## Commit & branch conventions

Conventional commits (`feat(model): …`, `test(engine): …`, `docs: …`), small commits per deliverable,
never force-push. Work happens on the assigned feature branch; each phase is reviewable as a coherent range.

---

## Clarifying questions

Each has a recommended default. If you reply "defaults OK", I proceed with all of them.

1. **Name, npm scope, license.** Keep "GameSpec", packages `@gamespec/*`, CLI binary `gamespec`; license?
   **Default:** keep the names; `UNLICENSED` (private) until you decide — easy to switch to MIT/Apache-2.0 later.

2. **Identifiers & expression syntax** *(schema).* Nodes have a kebab-case `id` (`revives-used-this-mission`)
   and a derived camelCase `key` (`revivesUsedThisMission`) used inside expressions, balance JSON, golden tests and code.
   Expressions are stored as strings (`revivesUsedThisMission < maxRevivesPerMission`) and parsed to an AST.
   **Default:** yes to both (the master prompt's golden example already mixes `rule:` ids with camelCase vars).
   Alternative: store JSON ASTs only (more verbose, less designer-friendly).

3. **Numeric policy** *(schema + engine).* Resources/counters are integers; curves declare rounding; the engine
   uses only exactly-specified float ops plus in-house `log/exp`, guaranteeing byte-identical results across
   Node and every browser. **Default:** yes. Alternative: allow `Math.*` and guarantee determinism only per
   runtime (simpler, but Node vs. Safari results could differ in the last digit).

4. **Rejected items & work files** *(Spec Pack).* Add a `gamespec/review.json` ledger (committed) recording
   approve/edit/reject decisions so re-extraction never resurrects rejected items; keep intermediates in
   `gamespec/.work/` (gitignored by a generated `gamespec/.gitignore`). `game-model.json` contains only
   promoted items. **Default:** yes.

5. **Studio hosting.** `gamespec studio` runs a localhost server (serves UI, reads/writes the repo, proxies LLM
   calls so the API key never reaches the browser), plus a static build that works with file import/zip export.
   **Default:** yes. Alternative: browser-only with the File System Access API (Chromium-only, key in browser).

6. **Golden-test reference runner** *(Spec Pack).* Ship it as zero-dependency TypeScript runnable with plain
   `node` ≥ 22.18 (native type stripping). **Default:** yes. Alternative: emit `.mjs` (works on older Node,
   loses types).

7. **Swarm Rescue's 22 screen states.** Unless you have the canonical list, I'll use:
   S00 Loading · S01 Consent/Privacy · S02 Home (hero select) · S03 HQ Rooftop · S04 Safe Zone · S05 Campaign Map ·
   S06 Mission Briefing · S07 Laser Trial (rewarded) · S08 Gameplay · S09 Boss Fight · S10 Kill-cam ·
   S11 Victory (star reveal) · S12 Claim 3x (rewarded) · S13 Interstitial (post-Victory → Continue) · S14 Defeat ·
   S15 Revive Offer (rewarded) · S16 Armory/Upgrades · S17 Upgrade Reroll (rewarded) · S18 Daily Chest ·
   S19 Settings · S20 Store/Remove Ads · S21 Pause. **Default:** this list, all marked `assumed`.

8. **Gameplay abstraction in simulation** *(schema).* Missions are not simulated frame-by-frame; an action
   (e.g. `play-mission`) has weighted `outcomes` (win/lose, stars, civilians saved, duration) whose weights are
   expressions over persona skill and level-difficulty constants. **Default:** yes. Combo multiplier, near-miss
   slow-mo, kill-cam are modelled only through their economy effects (e.g. score → stars → reward).

9. **Revenue assumptions** *(schema).* eCPM per format and fill rate live in `monetization.assumptions` as
   constants (`status: assumed`, US defaults: placeholders clearly labelled, not market data) and are sweepable.
   **Default:** yes, with placeholder values the gap pass flags for you to replace.

10. **LLM defaults & data policy.** `GAMESPEC_MODEL` defaults to `claude-opus-5-5`; extraction uses structured
    outputs with Zod; only chunks from the confirmed `IngestPlan` are sent; no telemetry. OK to also add an
    opt-in `--budget` cap (max input tokens per run)? **Default:** yes to all.
