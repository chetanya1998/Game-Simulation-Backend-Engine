# ADR 0004 — Game Model schema 0.1.0

- Status: Accepted (Phase 1) — open to revision before Phase 3 freezes the Spec Pack format
- Date: 2026-11-14

## Context

Phase 1 turns ARCHITECTURE §3 into a concrete schema. Several details were left open in the plan; the
choices below were needed to write the Swarm Rescue model and are recorded so they can be reviewed.

## Decisions

1. **Typed references** `prefix:id` (`ent res const var action rule state transition flow placement persona
kpi inv gap`). Each reference field accepts only the expected prefixes, so a wrong-kind reference is a
   schema error and a missing target is a reference error with a "did you mean".
2. **Expressions are strings** over camelCase keys (ADR 0002 §2), with dotted built-ins (`persona.skill`).
   Function whitelist: `min max clamp abs floor ceil round curve eligible`. `round` is half-to-even.
   `count`/`has` from the first draft were dropped as unneeded.
3. **`eligible("placement-id")`** lets transition guards branch on whether an ad would be shown
   (Victory → Continue goes to the interstitial screen only when it is eligible), instead of duplicating the
   eligibility conditions.
4. **Transitions carry the outcome**: `trigger` is `"ui"`, `"auto"` or an action ref, plus `outcome` for
   actions with random outcomes; outcomes themselves no longer name a next state. Self-loop transitions
   (`from == to`) express in-screen actions (buy upgrade in the Armory). `to: "return"` pops an overlay.
5. **Mission boundaries** are explicit on transitions (`beginsMission`, `endsMission`); mission-scoped
   variables reset at `beginsMission`.
6. **Variable scope `day`** was added (daily chest, rerolls per day) alongside player/session/mission/global.
7. **Limits, caps and cooldowns are desugared** by `normalizeGameModel()` into counter/timestamp variables,
   guard rules and effects with deterministic names (`<id>-count-<per>`, `<id>-last-at`, `<id>-limit-<per>`,
   `<id>-cooldown`) and default error codes (`<ID>_LIMIT_REACHED`, `<ID>_COOLDOWN_ACTIVE`). "Never" for a
   timestamp is `NEVER = -1e12`. Generated nodes carry `derivedFrom` and `provenance.source = "gamex:derived"`.
   Formulas and invariants may use the generated keys.
8. **Rules are guards only** (`appliesTo.actions` / `appliesTo.placements`). Checks over simulation output
   live in `invariants`, which are `trace` (optionally `at` a placement/action/state) or `aggregate` (over
   KPI keys and constants).
9. **Placements** gained `onShow` effects (where caps/cooldowns count impressions) and `inWorld` (billboards
   may appear during gameplay). Placements are triggered by an action (rewarded, IAP) or by entering a state
   (interstitial, banner, MREC).
10. **Entity kind `mechanic`** was added for GDD mechanics (combo multiplier, kill-cam, daily chest).
11. **Effects of one step are evaluated against the pre-step state** and applied together. This is a
    semantic the engine (Phase 2) must implement and the reference runner must match.
12. **Strict objects**: unknown fields are errors (typos are the most common hand-editing mistake).
13. **Canonical JSON**: section order fixed; within objects `id, key, name, kind, type, description` first,
    `provenance` last, the rest alphabetical; 2-space indent, trailing newline. The content hash is SHA-256
    of canonical JSON without `modelVersion`, `contentHash`, `createdAt`, `updatedAt`.
14. **A purpose-built JSON parser** records the line/column of every value so issues point into the file;
    it also rejects duplicate keys, which `JSON.parse` silently accepts.
15. **SHA-256 is implemented in TypeScript** inside `@gamex/model` so hashing is available in workers and
    browsers without Node's `crypto` (tested against FIPS vectors and `node:crypto`).

## Consequences

- The Swarm Rescue model (22 states, 50 transitions, 11 actions, 15 placements, 41 constants, 13 gaps)
  validates with zero errors and zero warnings.
- Choices 4, 7, 9 and 11 shape the Spec Pack's golden tests and OpenAPI contract; they should be confirmed
  before Phase 3.
