import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const gdd = readFileSync(new URL('../GDD.md', import.meta.url), 'utf8');

/** Rows of the §5 screen-flow table: `| S07 | Laser Trial | ad | … |`. */
function screenRows(): { id: string; name: string; kind: string }[] {
  return [...gdd.matchAll(/^\| (S\d{2}) \| ([^|]+?) +\| (\w+) +\|/gm)].map((m) => ({
    id: m[1] ?? '',
    name: m[2] ?? '',
    kind: m[3] ?? '',
  }));
}

describe('Swarm Rescue GDD fixture', () => {
  it('defines exactly 22 screen states S00 … S21 in order', () => {
    const ids = screenRows().map((r) => r.id);
    expect(ids).toEqual(Array.from({ length: 22 }, (_, i) => `S${String(i).padStart(2, '0')}`));
  });

  it('starts at Loading and ends at Pause', () => {
    const rows = screenRows();
    expect(rows[0]?.name).toBe('Loading');
    expect(rows[21]?.name).toBe('Pause');
  });

  it('marks gameplay screens so the no-UI-ads rule can be checked', () => {
    const gameplay = screenRows()
      .filter((r) => r.kind === 'gameplay')
      .map((r) => r.id);
    expect(gameplay).toEqual(['S08', 'S09', 'S10']);
  });

  it.each([
    'Downtown Avenue',
    'Midtown Intersection',
    'Burning Boulevard',
    'Financial District at Night',
    'Grand Central Intersection',
  ])('includes level %s', (level) => {
    expect(gdd).toContain(level);
  });

  it.each([
    'Relickeeper',
    'Vanguard',
    'wrist laser gauntlet',
    'Safe Zone',
    'HQ Rooftop',
    'Campaign Map',
  ])('mentions %s', (term) => {
    expect(gdd).toContain(term);
  });

  it('states every interstitial pacing rule', () => {
    for (const rule of [
      'only after Victory → Continue',
      'from Level 3 onward',
      'Max 1 per mission',
      'At least 180 seconds apart',
      'Never after a defeat',
      'Never on app open or app exit',
    ]) {
      expect(gdd).toContain(rule);
    }
  });

  it('lists the five rewarded placements', () => {
    for (const p of [
      'Victory Claim 3x',
      'Defeat revive',
      'Briefing laser trial',
      'Upgrade reroll',
      'Daily chest / free upgrade',
    ]) {
      expect(gdd).toContain(p);
    }
    expect(gdd).toContain('Max 1 revive per mission');
  });

  it('asks the open questions the gap pass must surface', () => {
    const questions = gdd.slice(gdd.indexOf('## 9. Open questions'));
    for (const topic of [
      'web build',
      'COPPA',
      'mediation stack',
      'IAP beyond Remove Ads',
      'currency amounts and upgrade costs',
    ]) {
      expect(questions).toContain(topic);
    }
  });

  it('marks undecided numbers as [ASSUMED]', () => {
    expect((gdd.match(/\[ASSUMED\]/g) ?? []).length).toBeGreaterThanOrEqual(10);
  });
});

describe('sample repo', () => {
  const economy = JSON.parse(
    readFileSync(new URL('../sample-repo/config/economy.json', import.meta.url), 'utf8'),
  ) as {
    rewarded: { maxRevivesPerMission: number };
    interstitial: { minLevel: number; minGapSeconds: number; maxPerMission: number };
  };

  it('agrees with the GDD on the rules the end-to-end test checks', () => {
    expect(economy.rewarded.maxRevivesPerMission).toBe(1);
    expect(economy.interstitial).toEqual({ minLevel: 3, maxPerMission: 1, minGapSeconds: 180 });
  });

  it('contains the planted .env canary used by repo-safety tests', () => {
    const env = readFileSync(new URL('../sample-repo/.env', import.meta.url), 'utf8');
    expect(env).toContain('PLANTED CANARY');
  });
});
