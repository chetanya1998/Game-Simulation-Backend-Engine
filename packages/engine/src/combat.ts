import type { Rng } from './random.js';

/**
 * Level 2 mission model (ADR 0005): a stylized, seeded, second-by-second combat simulation. It is not a
 * game engine — it turns tunable numbers (hero power, enemy waves, boss phases, player skill) into an
 * outcome, a duration and where the player died, so upgrades, revives and difficulty can be balanced.
 */
export interface CombatSpec {
  readonly heroHp: number;
  readonly heroDamage: number;
  readonly fireRate: number;
  readonly accuracy: number;
  readonly dodge: number;
  readonly damageMultiplier: number;
  readonly waves: number;
  readonly enemiesPerWave: number;
  readonly enemyHp: number;
  readonly enemyDamage: number;
  readonly boss:
    { readonly phases: number; readonly hp: number; readonly damage: number } | undefined;
  readonly maxSecondsPerStage: number;
}

/** Where a fight (re)starts: wave index, then boss phase index, both 0-based. */
export interface CombatPosition {
  readonly wave: number;
  readonly phase: number;
}

export interface CombatOutcome {
  readonly won: boolean;
  readonly seconds: number;
  readonly wavesCleared: number;
  readonly bossPhasesCleared: number;
  /** "wave-2", "boss-phase-1" (1-based), or null when won. */
  readonly diedAt: string | null;
  readonly timedOut: boolean;
  readonly hpLeft: number;
  /** 3, 2 or 1 by remaining health when won; 0 when lost. */
  readonly stars: number;
  /** Where a revive continues from (the stage the player died in). */
  readonly resumeAt: CombatPosition | undefined;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

function shotsThisSecond(rate: number, rng: Rng): number {
  const whole = Math.floor(rate);
  return whole + (rng.chance(rate - whole) ? 1 : 0);
}

/** Simulates one fight from `start` with full health. Pure given the rng. */
export function resolveCombat(
  spec: CombatSpec,
  rng: Rng,
  start: CombatPosition = { wave: 0, phase: 0 },
): CombatOutcome {
  const accuracy = clamp01(spec.accuracy);
  const dodge = clamp01(spec.dodge);
  const damage = Math.max(0, spec.heroDamage * spec.damageMultiplier);
  const fireRate = Math.max(0, spec.fireRate);
  const waves = Math.max(0, Math.floor(spec.waves));
  const enemies = Math.max(0, Math.floor(spec.enemiesPerWave));
  const phases = spec.boss === undefined ? 0 : Math.max(0, Math.floor(spec.boss.phases));
  const maxSeconds = Math.max(1, Math.floor(spec.maxSecondsPerStage));
  let hp = spec.heroHp;
  let seconds = 0;

  const fight = (targets: number[], attackDamage: number): 'cleared' | 'died' | 'timeout' => {
    for (let t = 0; t < maxSeconds; t++) {
      seconds++;
      for (let s = shotsThisSecond(fireRate, rng); s > 0; s--) {
        const i = targets.findIndex((x) => x > 0);
        if (i < 0) break;
        if (rng.chance(accuracy)) targets[i] = (targets[i] ?? 0) - damage;
      }
      const alive = targets.filter((x) => x > 0).length;
      if (alive === 0) return 'cleared';
      for (let a = 0; a < alive; a++) if (!rng.chance(dodge)) hp -= attackDamage;
      if (hp <= 0) return 'died';
    }
    return 'timeout';
  };

  const lost = (
    diedAt: string,
    resumeAt: CombatPosition,
    timedOut: boolean,
    wavesCleared: number,
    bossPhasesCleared: number,
  ): CombatOutcome => ({
    won: false,
    seconds,
    wavesCleared,
    bossPhasesCleared,
    diedAt,
    timedOut,
    hpLeft: Math.max(0, hp),
    stars: 0,
    resumeAt,
  });

  for (let w = Math.min(start.wave, waves); w < waves; w++) {
    const r = fight(
      Array.from({ length: enemies }, () => spec.enemyHp),
      spec.enemyDamage,
    );
    if (r !== 'cleared')
      return lost(`wave-${String(w + 1)}`, { wave: w, phase: 0 }, r === 'timeout', w, 0);
  }
  const firstPhase = start.wave >= waves ? Math.min(start.phase, phases) : 0;
  for (let p = firstPhase; p < phases; p++) {
    const r = fight([(spec.boss?.hp ?? 0) / phases], spec.boss?.damage ?? 0);
    if (r !== 'cleared')
      return lost(
        `boss-phase-${String(p + 1)}`,
        { wave: waves, phase: p },
        r === 'timeout',
        waves,
        p,
      );
  }
  const share = spec.heroHp <= 0 ? 0 : hp / spec.heroHp;
  return {
    won: true,
    seconds,
    wavesCleared: waves,
    bossPhasesCleared: phases,
    diedAt: null,
    timedOut: false,
    hpLeft: hp,
    stars: share > 2 / 3 ? 3 : share > 1 / 3 ? 2 : 1,
    resumeAt: undefined,
  };
}
