# The Game Model — a guide for designers

Everything GameX Engine knows about a game lives in one file, `game-model.json`. The simulator, the
studio, the Spec Pack and the drift check all read it. This page explains what goes in it and how to
write the small formulas ("expressions") it uses. The worked example throughout is
[`fixtures/swarm-rescue/swarm-rescue.game-model.json`](../fixtures/swarm-rescue/swarm-rescue.game-model.json).

The machine-readable schema is [`packages/model/schema/game-model.schema.json`](../packages/model/schema/game-model.schema.json)
(JSON Schema 2020-12), generated from the Zod schema in `packages/model/src/schema/`.

## Names: ids and keys

Every item has an **id** in kebab-case — `max-revives-per-mission`, `s11-victory`. Ids never change once
chosen; other items point to them.

Each id has a matching **key** in camelCase — `maxRevivesPerMission`, `s11Victory`. Keys are what you type
inside formulas, and what balance files, golden tests and game code use. You never write keys yourself:
they are derived from the id.

To point from one item to another, write a **reference**: the item's kind, a colon, and its id.

| Prefix        | Points to          | Example                              |
| ------------- | ------------------ | ------------------------------------ |
| `ent:`        | entity             | `ent:relickeeper`                    |
| `res:`        | resource           | `res:coins`                          |
| `const:`      | constant           | `const:interstitial-min-gap-seconds` |
| `var:`        | variable           | `var:damage-tier`                    |
| `action:`     | action             | `action:revive`                      |
| `rule:`       | rule               | `rule:no-interstitial-after-defeat`  |
| `state:`      | screen             | `state:s11-victory`                  |
| `transition:` | transition         | `transition:t-defeat-retry`          |
| `flow:`       | flow node          | `flow:wallet`                        |
| `placement:`  | ad / IAP placement | `placement:rewarded-revive`          |
| `persona:`    | persona            | `persona:casual-non-payer`           |
| `kpi:`        | KPI                | `kpi:coins-balance`                  |
| `inv:`        | invariant          | `inv:interstitial-min-gap`           |
| `gap:`        | gap                | `gap:gap-web-build`                  |

## Where every item came from: provenance

Every item carries a `provenance` block:

```json
{
  "source": "fixtures/swarm-rescue/GDD.md",
  "location": "§7.2 / line 150",
  "excerpt": "4. **At least 180 seconds apart.**",
  "confidence": "high",
  "status": "confirmed"
}
```

- `status` is `detected` (found by the AI, not yet reviewed), `confirmed`, `edited` or `assumed`.
- `assumed` means "we made this number up so the simulation can run". Every assumed item should be listed
  in a **gap** (see below); the validator warns when one is not.
- `source: "gamex:assumed"` marks an assumption with no source text; `gamex:derived` marks items the tool
  generates itself (see "Limits and cooldowns").

## Sections

| Section        | What it holds                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meta`         | Game name, genre, platforms, markets, `schemaVersion`, `modelVersion`.                                                                                                                |
| `entities`     | Heroes, enemies, NPCs, items, buildings and mechanics, with `attributes` that point to constants or variables.                                                                        |
| `resources`    | Currencies and countable things (`soft`, `hard`, `energy`, `xp`, `item`, `other`), whole numbers with a starting value and optional cap.                                              |
| `constants`    | Every tunable number. Each has a `unit`, optional `min`/`max`/`step` (for sliders and sweeps) and a `balanceFile` it is exported to. A constant can also be a **curve** (below).      |
| `variables`    | State that changes during play. `scope` says when it resets: `mission`, `session`, `day`, or never (`player`, `global`).                                                              |
| `actions`      | What a player or the system can do: `preconditions`, `costs`, `effects`, `limits`, `cooldown`, random `outcomes`, `duration`, and the `errorCode` returned when a precondition fails. |
| `rules`        | Extra guards checked before listed actions run or listed placements are shown.                                                                                                        |
| `stateMachine` | Screens (`states`) and how the player moves between them (`transitions`).                                                                                                             |
| `flows`        | The economy graph: `source`, `sink`, `converter`, `gate` and `pool` nodes per resource.                                                                                               |
| `monetization` | Ad and IAP `placements`, the `forbiddenStates` where no UI ad may appear, and optional revenue `assumptions` (eCPM, fill rate).                                                       |
| `personas`     | Simulated player types: share of players, sessions per day, session length, skill, ad opt-in, purchase rate, churn sensitivity.                                                       |
| `kpis`         | Metrics the simulator reports (progression speed, inflation, ad impressions per DAU, …).                                                                                              |
| `invariants`   | Checks the simulation must pass (see below).                                                                                                                                          |
| `gaps`         | Open questions, each with the items it concerns and whether it blocks a decision.                                                                                                     |

### Curves

Use a curve when a value depends on a tier or level `n`:

| Type        | Value at tier `n`                                                  | Example                           |
| ----------- | ------------------------------------------------------------------ | --------------------------------- |
| `linear`    | `base + perStep × (n − from)`                                      | 50 coins, +25 per level           |
| `geometric` | `base × ratio^(n − from)`                                          | upgrade cost 100, ×1.5 per tier   |
| `table`     | `values[n − from]`, clamped to the first/last entry                | waves per level `[3, 4, 5, 6, 6]` |
| `piecewise` | the first segment whose `upTo ≥ n`; the last segment has no `upTo` | linear to tier 5, then geometric  |

`from` defaults to 1. A curve may set `rounding` (`none`, `floor`, `ceil`, `round-half-even`) and a
`min`/`max` clamp. Read a curve in a formula with `curve(upgradeCost, damageTier + 1)`.

### Screens and transitions

A transition goes `from` one screen `to` another (or `to: "return"` to leave an overlay such as Pause
and go back where the player was). Its `trigger` is:

- `"ui"` — the player taps something; the simulated persona chooses among the available ui transitions;
- `"auto"` — taken as soon as its `guard` is true (e.g. after an ad finishes);
- an action reference — taken when that action succeeds. If the action has random outcomes, add
  `outcome: "win"` to say which outcome this transition follows.

`beginsMission: true` resets every mission-scoped variable; `endsMission: true` marks the end of a mission.

### Missions: the two-level model

Every mission resolves through **weighted outcomes** on an action (Level 1). Swarm Rescue's
`play-mission` has outcomes `win`, `waves-cleared` (on the boss level) and `lose`, each with a weight
formula based on the persona's skill, upgrade tier and level difficulty. An optional per-mission combat
model (Level 2: waves, boss, hero power) arrives with the engine in Phase 2; it will derive these weights
instead of you writing them.

### Limits and cooldowns

You write limits in plain terms — `"limits": [{ "max": "maxRevivesPerMission", "per": "mission" }]` — and
GameX turns them into ordinary model items: a counter variable (`revive-count-mission`, key
`reviveCountMission`), a rule (`revive-limit-mission`) that rejects the action with `REVIVE_LIMIT_REACHED`,
and an effect that counts each use. Cooldowns become a `…-last-at` timestamp and a `…-cooldown` rule. The
same happens for placement `caps` and `cooldownSeconds`. You can use these generated names in formulas and
invariants, e.g. `now - interstitialAfterVictoryLastAt >= interstitialMinGapSeconds`.

### Invariants

- `trace` invariants are checked on every simulated step, or only `at` a placement, action or screen. Use
  them for rules that must **never** break: "an interstitial is never shown after a defeat".
- `aggregate` invariants are checked on the results, using KPI keys: `reachLevel5ByDay7 >= 0.6`.

## Formulas (expressions)

Formulas are short strings evaluated by GameX's own interpreter — never by the AI and never with `eval`.
They give the same answer on every computer.

| You can use                                | Examples                                                                                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| numbers, `true`/`false`, `"strings"`       | `180`, `0.25`, `1e6`, `"victory"`                                                                                                            |
| keys of constants, variables and resources | `coins`, `damageTier`, `interstitialMinLevel`                                                                                                |
| built-ins                                  | `now` (simulated seconds), `state`, `prevState` (screen ids), `persona.skill`, `persona.churnSensitivity`                                    |
| arithmetic                                 | `+ - * / %`                                                                                                                                  |
| comparison                                 | `< <= > >= == !=`                                                                                                                            |
| logic                                      | `&& \|\| !` and `condition ? a : b`                                                                                                          |
| functions                                  | `min(a, b, …)`, `max(…)`, `clamp(x, lo, hi)`, `abs`, `floor`, `ceil`, `round` (halves to even), `curve(name, n)`, `eligible("placement-id")` |

Rules worth knowing:

- Every formula has a type. Preconditions, guards, eligibility, rules and invariants must be true/false;
  amounts, weights, durations and limits must be numbers; effects must match the variable they set.
- Text values are checked: `lastMissionResult == "victroy"` is an error ("did you mean "victory"?"), and
  so is a misspelled screen id in `state == "…"`.
- Dividing by zero is an error, not infinity. Guard it: `x / max(n, 1)`.
- All effects of one step are computed from the state **before** the step, then applied together.

## Validation

`gamex validate` (Phase 3) and the `validateGameModel()` function check a model in layers and report every
problem at once, each with the file, line and column, the JSON path, what is wrong and how to fix it:

```
swarm-rescue.game-model.json:2704:12: error EXPR_UNKNOWN_IDENTIFIER at /monetization/placements/5/eligibility/1:
  Unknown name "missionLevl" — in "missionLevl >= interstitialMinLevel" at character 1 — Did you mean "missionLevel"?
```

1. **JSON syntax** — the file can be read.
2. **Schema version** — the file is not from a newer or unsupported GameX version.
3. **Schema** — every field has the right shape; unknown fields (often typos) are errors.
4. **Identity** — ids are unique, and keys don't collide inside formulas.
5. **References** — every reference points to an existing item; transition outcomes exist on their action.
6. **Formulas** — every formula parses and has the right type.
7. **Ranges** — values sit inside `min`/`max`, steps divide ranges, persona shares add up to 1.
8. **Design checks** — no UI ad can appear in a forbidden screen (in-world billboards excepted); warnings for
   unused constants, resources that never change, assumed items without a gap, and revenue KPIs without
   revenue assumptions.
