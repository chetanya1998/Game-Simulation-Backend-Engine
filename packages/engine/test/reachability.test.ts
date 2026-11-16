import { describe, expect, it } from 'vitest';
import { abstractEnvFor, abstractEval, analyzeReachability, neverTrue } from '@gamex/engine';
import { parseExpr } from '@gamex/model';
import { minimalModel, swarmRescue } from './helpers.ts';
import { brokenFlowModel } from './models/broken-flow.ts';

describe('analyzeReachability on a model with planted defects', () => {
  const report = analyzeReachability(brokenFlowModel());
  const find = (kind: string) => report.issues.filter((i) => i.kind === kind).map((i) => i.ref);

  it('finds the unreachable screen', () => {
    expect(find('unreachable-state')).toEqual(['state:secret']);
  });
  it('finds the dead end', () => {
    expect(find('dead-end')).toEqual(['state:void']);
  });
  it('finds the inescapable loop', () => {
    expect(report.issues.find((i) => i.kind === 'trap')).toMatchObject({
      states: ['loop-a', 'loop-b'],
      severity: 'error',
    });
  });
  it('finds conditions that can never be true within declared ranges', () => {
    expect(find('never-true-guard')).toEqual(['transition:impossible-exit']);
    expect(find('never-true-precondition')).toEqual(['action:impossible']);
    expect(find('never-eligible-placement')).toEqual(['placement:banner-never']);
  });
  it('reports nothing else', () => {
    expect(report.issues.map((i) => i.kind).sort()).toEqual(
      [
        'dead-end',
        'never-eligible-placement',
        'never-true-guard',
        'never-true-precondition',
        'trap',
        'unreachable-state',
      ].sort(),
    );
  });
});

describe('analyzeReachability on Swarm Rescue', () => {
  const report = analyzeReachability(swarmRescue());

  it('finds no reachability errors in the 22-screen flow', () => {
    expect(report.issues).toEqual([]);
    expect(report.states).toBe(22);
  });

  it('has a concrete witness path to every screen', () => {
    expect(Object.keys(report.witnesses).sort()).toHaveLength(22);
    const toInterstitial = report.witnesses['s13-interstitial'] ?? [];
    expect(toInterstitial.at(-1)).toMatchObject({
      action: 'victory-continue',
      transition: 't-victory-continue-interstitial',
      to: 's13-interstitial',
    });
    // Interstitials start at level 3, so the path wins at least three missions first.
    expect(toInterstitial.filter((s) => s.outcome === 'win')).toHaveLength(3);
  });
});

describe('the explored-state budget', () => {
  it('warns (not errors) when the search stops before reaching a screen', () => {
    const r = analyzeReachability(minimalModel(), { maxNodes: 1 });
    expect(r.explored).toMatchObject({ nodes: 1, complete: false });
    expect(
      r.issues.every((i) => i.kind === 'not-reached-concretely' && i.severity === 'warning'),
    ).toBe(true);
    expect(r.issues.length).toBeGreaterThan(0);
  });

  it('errors when guards block every path to a connected screen', () => {
    const m = minimalModel();
    const start = m.stateMachine.transitions[0];
    if (start) start.guard = 'tier >= 5';
    const r = analyzeReachability(m);
    expect(
      r.issues
        .filter((i) => i.kind === 'not-reached-concretely' && i.severity === 'error')
        .map((i) => i.ref),
    ).toEqual(expect.arrayContaining(['state:game']));
  });
});

describe('interval analysis', () => {
  const env = abstractEnvFor(minimalModel(), 'menu');
  const ev = (src: string) => {
    const p = parseExpr(src);
    if (!p.ok) throw new Error(p.error.message);
    return abstractEval(p.value, env);
  };
  it.each([
    ['tier > 10', true],
    ['tier >= 10', false],
    ['tier < 0 || tier > 10', true],
    ['tier + 5 < 5', true],
    ['tier * 2 > 20', true],
    ['abs(tier - 20) < 10', true],
    ['min(tier, 3) > 3', true],
    ['max(tier, 3) < 3', true],
    ['clamp(tier, 0, 4) > 4', true],
    ['floor(tier) > 10', true],
    ['state == "game"', true],
    ['state == "menu"', false],
    ['result == "lost"', true],
    ['!(tier <= 10)', true],
    ['tier / 2 > 5', true],
    ['tier / (tier - 1) > 5', false],
    ['(tier > 3 ? 1 : 2) > 2', true],
    ['true == false', true],
    ['coins < 0', true],
    ['heroHp > 200', true],
    ['heroHp >= 200', false],
    ['eligible("interstitial")', false],
    ['persona.skill > 1', true],
  ])('%s → never true: %s', (src, expected) => {
    expect(neverTrue(src, env)).toBe(expected);
  });
  it('produces numeric intervals', () => {
    expect(ev('tier * 2 - 1')).toEqual({ kind: 'num', lo: -1, hi: 19 });
    expect(ev('-tier')).toEqual({ kind: 'num', lo: -10, hi: -0 });
  });
});
