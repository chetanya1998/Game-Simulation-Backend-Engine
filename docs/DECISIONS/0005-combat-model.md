# ADR 0005 — Level 2 combat model

- Status: Accepted (Phase 2)
- Date: 2026-11-16

## Context

ADR 0002 §8 asked for a two-level mission model: Level 1 weighted outcomes always present, plus an optional
per-mission combat block that derives outcome probabilities from hero power, enemies and player skill.

## Decision

- **Schema:** `Action.combat` (optional) with number expressions `heroHp, heroDamage, fireRate, accuracy,
dodge, damageMultiplier?, waves, enemiesPerWave, enemyHp, enemyDamage, boss? { phases, hp, damage },
maxSecondsPerStage?` and `outcomes: { win, lose }` naming two of the action's outcome ids. The validator
  type-checks every field as a number and reports `COMBAT_UNKNOWN_OUTCOME` for an unknown outcome id.
- **Resolution** (`resolveCombat`): one-second ticks. The hero fires `fireRate` shots (the fractional part
  is a chance), each hitting the first living target with probability `accuracy` for
  `heroDamage × damageMultiplier`. Then each living enemy (or the boss) attacks once and hits unless dodged.
  Waves come first, then boss phases (`hp / phases` each). Dying or exceeding `maxSecondsPerStage` (default 120) loses. Stars: 3/2/1 by remaining health above 2/3, 1/3, else.
- **Integration:** the action's outcome is the combat result; the action's `duration` is replaced by the
  combat time; a `combat` event records `diedAt` (`wave-n` / `boss-phase-n`). A lost fight stores a resume
  point (`WorldState.combatResume`), so a revive continues from the stage where the player died with full
  health; starting a mission clears it. Combat uses the step's seeded rng.
- **Level 1 stays the contract:** outcome weights remain required; golden tests force outcomes and never
  sample combat; actions without `combat` behave exactly as before (tested).
- **Swarm Rescue:** only the L5 boss fight (`fight-boss`) gets a combat block; all its new numbers are
  `assumed` and listed in `gap-combat-stats`.

## Consequences

- Upgrades (`damageTier`) now move the boss win rate; the progression-walls KPI and per-stage death counts
  show where players stall and how much a revive is worth.
- Reports must say outcomes come from a stylized combat model, not real gameplay.
