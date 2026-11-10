# MASTER PROMPT — GameSpec Studio (working name)

> **Naming note:** the product is now **GameX Engine** (ADR 0002). This brief is kept verbatim; read "GameSpec" as GameX Engine, `gamespec` as `gamex`, and `/gamespec/` as `/gamex/`.

> **How to use:** place this file at `docs/MASTER_PROMPT.md` in an empty repo, open Claude Code in the repo root, and say: "Read docs/MASTER_PROMPT.md in full and follow it. Start with Section 12 (Session Protocol)." Rename "GameSpec" anywhere once a final product name is chosen.

## 1. Your role

You are the founding engineer and technical architect of GameSpec Studio. You think like a senior systems/economy game designer, a backend engineer who has shipped live-ops mobile games, and a developer-tools engineer who cares about determinism, testability, and clean interfaces.

You will design and build this product incrementally, in phases, with tests at every step. You plan before you build, you ask when a decision is genuinely ambiguous, and you never fake progress (no stubbed "TODO" functions presented as done, no tests that assert nothing).

## 2. The product in one paragraph

GameSpec Studio turns a game idea into a buildable, testable, repo-native spec. A user uploads a GDD (Markdown/text; PDF optional) and/or points the tool at a game project repository (README.md, config files, selected source files). The tool detects the game's mechanics, characters/entities, player actions (methods), variables, constants, rules, states, and resource flows; normalizes them into one canonical Game Model; lets the user review and correct every detected item; then explores outcomes through simulation (state-machine reachability, Monte Carlo player simulation, parameter sweeps, sensitivity analysis, exploit search). Finally it writes a Spec Pack into the game repo — `AGENTS.md`, schemas, balance files, formulas, backend contracts, golden tests, and build tasks — so that coding agents (Claude Code, Codex, Antigravity, Cursor, etc.) can build the backend directly from it, with no copy-paste. The spec stays in the repo, versioned, and a drift check keeps spec and code in sync.

Primary users: game designers, economy designers, product managers, and game agencies working on mobile/hybrid-casual games, including ad-monetized games (rewarded, interstitial, banner, MREC).

## 3. Non-negotiable principles

1. **One canonical Game Model.** Every input is normalized into `game-model.json`. The simulator, the studio UI, the exporters, and the drift checker all read from it. No feature may bypass it.
2. **The LLM proposes; deterministic code decides.** LLMs are used for extraction, gap-finding, naming, and explanations. All numbers, simulations, validations, and test expectations come from deterministic, tested code. Never let an LLM compute a simulation result or a golden-test expectation.
3. **Provenance on everything.** Every detected item carries: source file, location (page/line/section), a short excerpt, a confidence level, and a status (`detected | confirmed | edited | assumed`). Nothing is simulated or exported without passing through review (CLI or UI).
4. **Determinism.** Same model + same seed = byte-identical results. Use a seeded PRNG everywhere. No `Math.random()`.
5. **Repo-native output.** The tool writes files into the target repo (via local CLI now, PR-based Git app later). Users never copy-paste.
6. **Vendor-neutral agent output.** `AGENTS.md` is the canonical agent instruction file; `CLAUDE.md` and `GEMINI.md` are thin shims pointing to it. Skills use the portable `SKILL.md` format.
7. **Honest scope.** We never claim to enumerate "all possible outcomes." We provide systematic exploration: reachability over the state machine, statistical simulation, sweeps, sensitivity, and adversarial exploit search, plus designer-defined invariants.
8. **Safety with user repos.** Respect `.gitignore`. Never read or send `.env*`, keys, certificates, or credential files to any LLM. Enforce an extension allowlist and per-file size limits. Show the user exactly which files will be sent before sending.

## 4. Tech stack (default — challenge it in your plan if you have a strong reason)

- **Language:** TypeScript (strict mode) end to end, so the same core engine runs in Node (CLI, CI, MCP) and in the browser (studio).
- **Monorepo:** pnpm workspaces + Turborepo.
- **Schema:** Zod as the source of truth → generate JSON Schema (`zod-to-json-schema`) for agents and CI.
- **LLM:** Anthropic TypeScript SDK, using tool use / structured outputs for extraction. Model name comes from an env var (`GAMESPEC_MODEL`); API key from `ANTHROPIC_API_KEY`. Wrap all LLM calls behind a `LlmProvider` interface so other providers can be added later.
- **CLI:** `commander` (or `citty`), with `--json` output on every command for agent consumption.
- **Studio UI:** Vite + React + TypeScript, React Flow for graphs, a charting library (ECharts or Recharts), simulation in Web Workers.
- **PDF (optional input):** `unpdf` or `pdfjs-dist` text extraction, page numbers retained for provenance.
- **Testing:** Vitest; property-based tests with `fast-check` for the engine.
- **Lint/format:** ESLint + Prettier. **CI:** GitHub Actions.
- **Later:** MCP server via the official MCP TypeScript SDK; GitHub App for PR-based delivery.

## 5. Repository layout (this product's own repo)

```
/AGENTS.md                      ← rules for agents working ON this repo (dogfooding)
/CLAUDE.md                      ← shim: "Follow @AGENTS.md"
/docs/
  MASTER_PROMPT.md              ← this file
  ARCHITECTURE.md               ← you write and maintain this
  DECISIONS/                    ← short ADRs: 0001-*.md, 0002-*.md …
/packages/
  model/                        ← Zod schemas, types, validation, JSON Schema generation
  ingest/                       ← file discovery, readers (md/txt/pdf/code/config), chunking
  extract/                      ← LLM extraction → candidate model + provenance + gaps
  engine/                       ← deterministic simulation + exploration (no I/O, no LLM)
  specpack/                     ← writes the Spec Pack into a target repo
  drift/                        ← compares repo code/config against the model
  cli/                          ← `gamespec` command
/apps/
  studio/                       ← the visualization studio (web UI)
/fixtures/
  swarm-rescue/                 ← first real test case (see Section 11)
/.github/workflows/             ← CI for this repo
```

## 6. The Game Model (canonical schema)

Design this carefully; it is the heart of the product. Use stable string IDs (`kebab-case`), and every node includes a `provenance` block. Required top-level sections:

- **meta:** game name, genre, platform, target market, schema version, model version, created/updated timestamps.
- **entities:** characters, heroes, enemies, NPCs, items, buildings. Fields: id, kind, name, attributes (referencing variables/constants), tags.
- **resources:** currencies and countable things (soft currency, hard currency, energy, XP, keys, tickets). Fields: id, kind (`soft | hard | energy | xp | item | other`), cap (optional), starting value.
- **constants:** tunable values with `value`, `unit`, `min`, `max`, `step`, and `description`. These become the balance files. Curves (e.g., upgrade cost per tier) are first-class: `{ type: "linear" | "geometric" | "table" | "piecewise", params }`.
- **variables:** mutable state (player level, wallet balances, mission count, revives used this mission, last interstitial timestamp). Scope: `player | session | mission | global`.
- **actions (methods):** what a player or the system can do. Fields: id, actor, preconditions (expressions), costs, effects (state deltas), cooldowns, per-scope limits, randomness (distributions referencing constants).
- **rules / conditions:** invariants and policies (e.g., "max 1 revive per mission", "no interstitial after defeat"). Each has an expression and a severity.
- **states & transitions:** the game-loop state machine (screens / modes) with guards and triggering actions. Must be able to represent win, lose, retry, pause, next level, and exit loops.
- **flows:** economy graph nodes — `source`, `sink`, `converter`, `gate`, `pool` — linked to resources and actions.
- **monetization:** placements with `format` (`rewarded | interstitial | banner | mrec | iap | offerwall`), trigger (action or state), eligibility conditions, caps, cooldowns, reward (if any), and the states where ads are forbidden.
- **personas:** simulated player types with behavior parameters (session length/frequency, skill distribution, ad opt-in probability, purchase probability, churn sensitivity).
- **kpis:** named metrics the simulator computes (see Section 8).
- **invariants:** designer-defined checks evaluated against simulation output (e.g., "≥60% of non-payers reach Level 5 by day 7", "no resource grows unbounded", "interstitial gap ≥180s in 100% of sessions").
- **gaps:** a list of things the model is missing or ambiguous about, each with a question for the user.

**Expressions:** define a small, safe, deterministic expression language (or a constrained JSON AST) for preconditions, guards, effects, and invariants. No `eval`. Write a parser + evaluator with thorough tests.

**Provenance block (on every node):**

```json
{ "source": "docs/GDD.md", "location": "§4.2 / lines 88–94", "excerpt": "…≤200 chars…",
  "confidence": "high | medium | low", "status": "detected | confirmed | edited | assumed" }
```

## 7. Ingestion & extraction pipeline

1. **Discover inputs.** Accept: GDD (`.md`, `.txt`; `.pdf` optional; `.docx` later), project `README.md`, and repo files that likely hold balance data (JSON/YAML/TOML configs, Unity ScriptableObject `.asset` files, C# / GDScript / TS files containing constants or tuning classes). Use heuristics + filename patterns + a size cap. Present the file list to the user for confirmation before any LLM call.
2. **Chunk with locations.** Every chunk keeps file path + line range (or PDF page) so provenance is exact.
3. **Extract in passes** (each pass is a structured tool-use call returning Zod-validated JSON; invalid output is retried with the validation errors fed back, max 2 retries):
   - Pass A: entities, resources, monetization placements.
   - Pass B: actions/methods, rules/conditions, states & transitions.
   - Pass C: constants & variables (prefer code/config values over GDD prose; record both if they conflict).
   - Pass D: gap finding — what's missing, contradictory, or assumed.
4. **Merge & deduplicate deterministically** (ID normalization, alias matching). Conflicts between GDD and code are recorded as drift candidates, not silently resolved.
5. **Review.** CLI review (`gamespec review`) and studio review screen: approve, edit, reject, or mark as assumed. Only confirmed/edited/assumed items flow into simulation and export.

## 8. Outcome exploration engine (`packages/engine`)

Pure, deterministic, no I/O. Must run in Node and in a Web Worker.

1. **Reachability analysis:** BFS/DFS over the state machine. Report unreachable states, dead ends, loops with no progress exit, and transitions whose guards can never be true given constant ranges.
2. **Monte Carlo player simulation:** N simulated players per persona over D days; session model; per-action decisions driven by persona parameters and the model's actions/rules. Output time series per resource and per KPI, plus distributions (p10/p50/p90).
3. **Parameter sweeps:** grid and Latin-hypercube sampling over selected constants within their min/max.
4. **Sensitivity analysis:** one-at-a-time sensitivity → tornado ranking of which constants move which KPIs most. (Variance-based methods can come later.)
5. **Exploit search:** an adversarial "optimizer" agent that greedily or via random restarts maximizes resource gain per minute or progression speed; flag unbounded growth, infinite reward loops, and cap violations.
6. **Invariant evaluation:** evaluate every invariant against results and report pass/fail with the evidence (seed, persona, day, trace excerpt).

**Default KPIs:** progression speed (time/sessions to reach each level), currency balance over time & inflation rate, faucet/sink ratio, progression walls (where a persona stalls), churn-risk points, ad impressions per DAU by format, rewarded opt-in rate, estimated ad revenue per DAU (using user-supplied eCPM assumptions), IAP conversion & ARPPU (if IAP exists), and ARPDAU.

Every run is reproducible: `{ modelVersion, seed, personas, days, params }` is stored with the results.

## 9. Spec Pack — what gets written into the TARGET game repo

`gamespec init` / `gamespec sync` writes and updates:

```
/AGENTS.md                  ← adds or updates a delimited "GameSpec" section only
/CLAUDE.md                  ← shim referencing AGENTS.md (create only if missing)
/GEMINI.md                  ← shim referencing AGENTS.md (create only if missing)
/gamespec/
  README.md                 ← what this folder is, how to use it, how to regenerate
  game-model.json           ← canonical model (versioned)
  schema/game-model.schema.json
  balance/*.json            ← all tunables; game/backend code must READ these
  formulas/
    FORMULAS.md             ← human-readable formulas and curves
    reference.ts            ← reference implementation of every formula
  state-machine.json        ← plus STATE_MACHINE.md with a Mermaid diagram
  backend/
    openapi.yaml            ← economy endpoints (grant, claim, claim-multiplied, revive, purchase, daily-chest, …)
    data-model.sql          ← wallet, inventory, progression, ad-claim log, idempotency keys
    RULES.md                ← server-authoritative rules, caps, cooldowns, anti-cheat, rewarded-ad server-side verification
  tests/golden/*.json       ← given/when/then cases derived from rules + simulation traces
  tests/README.md           ← how any language can load and run the golden cases
  tasks/                    ← ordered build tasks: 001-wallet-service.md, 002-reward-claim.md …
  skills/
    gamespec-change-balance/SKILL.md
    gamespec-run-sim/SKILL.md
    gamespec-implement-task/SKILL.md
  reports/
    latest-sim.md           ← key findings, failing invariants, sensitivity ranking
    drift.md                ← spec vs code differences
```

Rules for the Spec Pack:

- The `AGENTS.md` GameSpec section is short (≈30–60 lines): the core rules (never hardcode economy values; read from `/gamespec/balance`; implement against `/gamespec/backend/openapi.yaml`; a task is done only when its golden tests pass; economy changes go through `gamespec` and must rerun the sim) plus pointers to detail files. Agents load detail files on demand.
- Generated files start with a header: `GENERATED BY GAMESPEC — edit via the studio or the gamespec CLI`. Hand-editable files (RULES.md narrative sections, tasks) are marked as editable.
- Golden test format:

```json
{ "id": "revive-limit-002", "rule": "rule:max-one-revive-per-mission",
  "given": { "state": "mission.defeat", "vars": { "revivesUsedThisMission": 1 } },
  "when": { "action": "revive.request" },
  "then": { "result": "rejected", "error": "REVIVE_LIMIT_REACHED", "deltas": {} } }
```

- Each task file includes: goal, inputs (which spec files), acceptance criteria (which golden tests must pass), out of scope.
- Writes are idempotent: running `sync` twice produces no diff. Never touch files outside `/gamespec` except the delimited section of `AGENTS.md` and the shims.

## 10. CLI, Studio, Drift, CI

**CLI (`gamespec`)** — every command supports `--json`:

- `init` — scan repo + GDD, run extraction, start review, write Spec Pack.
- `ingest` / `extract` / `review` — individual pipeline steps.
- `validate` — schema + expression + reference integrity checks.
- `sim` — run simulations (`--persona`, `--days`, `--players`, `--seed`, `--sweep`).
- `explore` — reachability + exploit search + invariants.
- `sync` — regenerate the Spec Pack from the model.
- `drift` — compare repo code/config against the model; non-zero exit on blocking drift.

**Studio (`apps/studio`) views:**

1. Upload & sources (file picker + repo path, file list confirmation).
2. Review (every detected item with provenance, confidence, approve/edit/reject).
3. Entity map.
4. Economy flow graph (sources, sinks, converters, gates, pools).
5. State machine view (with reachability problems highlighted).
6. Parameter panel (sliders bound to constants with min/max/step).
7. Scenario runner (pick personas, days, players, seed; run in a Web Worker).
8. Outcomes dashboard (time series, distributions, sensitivity tornado, invariant pass/fail, exploit findings).
9. Variant compare (A vs B side by side).
10. Spec Pack preview & write.

The studio must support light and dark mode and work fully offline except for the LLM extraction step.

**Drift detection:** re-extract constants/rules from the repo's code/config and diff against `game-model.json`. Classify each drift: `value-mismatch | missing-in-code | missing-in-spec | rule-violation`. Write `reports/drift.md`.

**CI (template for target repos):** a GitHub Action that, on PRs touching `/gamespec/balance` or code paths, runs `gamespec validate`, `gamespec drift`, and a quick `gamespec sim`, and posts a summary.

## 11. First fixture: Swarm Rescue

Create `/fixtures/swarm-rescue/` with a GDD-style Markdown file based on the following (use it as the end-to-end test case). Where numbers are not given, add placeholder constants with `status: "assumed"` so the gap-finding pass has something to report.

- Mobile action game for a US audience: the player shoots drone swarms in city levels, saves civilians, and fights a boss.
- Two launch heroes, selectable on Home, with identical controls and stats (Relickeeper, Vanguard); both use a wrist laser gauntlet.
- Levels: L1 Downtown Avenue, L2 Midtown Intersection, L3 Burning Boulevard, L4 Financial District at Night, L5 Grand Central Intersection (boss). Plus Safe Zone, HQ Rooftop (menus), Campaign Map.
- 22 screen states (S00 Loading → S21 Pause) with win/lose/retry/pause/next-district loops.
- Guiding rule: no UI ads during live gameplay; in-world billboards on city buildings are the only ad allowed during gameplay.
- **Rewarded (main format):** Victory Claim 3x; Defeat revive (max 1 per mission); Briefing laser trial; Upgrade reroll; daily chest / free upgrade.
- **Interstitial:** only after Victory → Continue, from Level 3 onward, max 1 per mission, ≥180 s apart, never after defeat, never on app open/exit.
- **Banner:** Home (Level 3+), Campaign Map, Armory, Settings. **MREC / outstream video:** Pause, Victory, Defeat.
- **Proposed mechanics:** combo multiplier, near-miss slow-mo, final-blow kill-cam, Victory star reveal, daily chest.
- **Open questions to surface as gaps:** web build? age rating / COPPA? mediation stack? IAP beyond Remove Ads? currency amounts and upgrade costs?

**End-to-end acceptance for the fixture:** `gamespec init` on a sample repo containing this GDD produces a valid model, flags the expected gaps, finds no reachability errors in the screen flow, proves via golden tests and simulation that interstitial rules are never violated, and writes a complete Spec Pack.

## 12. Session protocol (how you work)

1. Read this whole file. Then explore the repo (it may be empty).
2. **Plan first.** Before writing code, produce `docs/ARCHITECTURE.md` and a phase plan covering Section 13. List at most 10 clarifying questions in one batch, each with your recommended default. Then stop and wait for my approval.
3. **Work phase by phase.** At the end of every phase, stop and report: what was built, how to run it, test results (actual output), known limitations, and what's next. Wait for "continue" before starting the next phase.
4. **Record decisions.** Any non-trivial choice gets a short ADR in `docs/DECISIONS/`.
5. **Commit small and often** with conventional commit messages (`feat(engine): …`). Never commit secrets. Never force-push.
6. **Tests are the definition of done.** A phase is not done until its tests pass and `pnpm lint && pnpm test && pnpm build` succeed from a clean checkout.
7. **Ask instead of guessing** when a choice affects the Game Model schema, the Spec Pack format, or anything written into a user's repo.
8. Keep `AGENTS.md` (this repo) updated with the commands, conventions, and rules a new agent would need.

## 13. Phases & acceptance criteria

- **Phase 0 — Foundation.** Monorepo scaffold, TypeScript strict, lint/format/test/build wiring, CI workflow, `AGENTS.md` + `CLAUDE.md` shim, `docs/ARCHITECTURE.md`, Swarm Rescue fixture. ✅ `pnpm install && pnpm lint && pnpm test && pnpm build` pass on a clean clone; CI green.
- **Phase 1 — Game Model.** Zod schemas for all sections in Section 6, expression language (parser + evaluator), validation (schema, references, expressions, constant ranges), JSON Schema generation, a hand-written `swarm-rescue.game-model.json`. ✅ Fixture model validates; invalid models produce precise, located errors; expression evaluator has property-based tests.
- **Phase 2 — Engine.** Seeded PRNG, reachability analysis, Monte Carlo simulation, KPIs, invariants, sweeps, sensitivity, exploit search. ✅ Determinism test (same seed → identical output); reachability finds seeded defects in a test model; exploit search detects a deliberately planted infinite-reward loop; Swarm Rescue interstitial invariants pass.
- **Phase 3 — Spec Pack + CLI.** `specpack` writer, golden-test generation, task generation, `AGENTS.md` section management, shims, skills; CLI commands `validate`, `sim`, `explore`, `sync`. ✅ `sync` is idempotent; generated JSON validates against the schema; golden tests are executable by a minimal reference runner included in the pack.
- **Phase 4 — Ingestion & extraction.** File discovery with allowlist and secret exclusion, chunking with locations, multi-pass LLM extraction with Zod validation and retries, merge/dedupe, gap finding, CLI review; `init` end to end. ✅ On the Swarm Rescue fixture, extraction recovers the listed placements and rules with provenance; expected gaps are reported; no excluded file is ever sent (tested with a planted `.env`). LLM calls are mocked in unit tests; one opt-in live test.
- **Phase 5 — Studio.** All views in Section 10, simulation in a Web Worker, light/dark mode. ✅ A user can go from upload → review → tweak a constant → run → compare variants → write Spec Pack without touching the CLI.
- **Phase 6 — Drift & CI template.** Drift detection, `reports/drift.md`, GitHub Action template for target repos. ✅ A planted mismatch (e.g., code allows 3 revives) is detected and reported with file/line.
- **Phase 7 (later) — MCP server & Git app.** MCP server exposing read-only model queries and `sim`/`explore`; PR-based delivery.

## 14. Non-goals (for now)

- No game runtime or client code generation; we generate specs, contracts, references, and tests that agents build from.
- No claims of predicting real player psychology or retention; simulation is about economy mechanics under stated persona assumptions.
- No multi-user accounts, billing, or cloud hosting in the first version.
- No support for every genre at launch: optimize for mobile action / hybrid-casual / ad-monetized games first.

## 15. Quality bar

- Clear names, small modules, no circular dependencies between packages (`engine` must not import `extract` or any I/O).
- Errors are actionable: what failed, where (file/line/node id), and how to fix it.
- Every public function in `model` and `engine` has tests; coverage target ≥85% for those two packages.
- Documentation is written for a game designer as well as an engineer.

Begin now with Section 12, step 1.
