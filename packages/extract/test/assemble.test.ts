import { validateGameModel } from '@gamex/model';
import { describe, expect, it } from 'vitest';
import {
  assembleCandidate,
  decide,
  EMPTY_LEDGER,
  itemHash,
  promote,
  reviewItems,
  type ReviewLedger,
} from '@gamex/extract';
import { CHUNKS, tinyOutputs } from './helpers.js';

describe('assembleCandidate', () => {
  const { model, report } = assembleCandidate(tinyOutputs(), CHUNKS);
  const constant = (id: string) => model.constants.find((c) => c.id === id);

  it('produces a valid model', () => {
    expect(validateGameModel(model).issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(model.meta).toMatchObject({
      name: 'Tiny',
      platforms: ['ios'],
      schemaVersion: '0.1.0',
      modelVersion: 0,
    });
  });

  it('normalizes ids and references, and records the aliases', () => {
    expect(model.stateMachine.states.map((s) => s.id)).toEqual(['home', 'play']);
    expect(model.stateMachine.initial).toBe('state:home');
    expect(report.aliases).toContainEqual({ from: 'Home', to: 'home' });
    expect(constant('coins-per-win')?.balanceFile).toBe('economy');
    expect(model.actions.find((a) => a.id === 'play-run')?.errorCode).toBe('CANNOT_PLAY');
  });

  it('lets the config value win over the design document and keeps the other as an alternative', () => {
    expect(constant('max-revives')).toMatchObject({
      value: 3,
      provenance: {
        source: 'config/game.json',
        location: 'line 2',
        excerpt: '"maxRevives": 3,',
        confidence: 'high',
        alternatives: [
          {
            source: 'docs/design.md',
            location: '§3 / line 11',
            value: 2,
            excerpt: 'Revive at most **2 times** per run.',
          },
        ],
      },
    });
    expect(report.conflicts).toEqual([
      {
        ref: 'const:max-revives',
        chosen: { source: 'config/game.json', location: 'line 2', value: '3' },
        others: [{ source: 'docs/design.md', location: '§3 / line 11', value: '2' }],
      },
    ]);
    expect(model.gaps.find((g) => g.id === 'gap-conflict-max-revives')).toMatchObject({
      kind: 'contradiction',
      related: ['const:max-revives'],
    });
  });

  it('flags quotes that are not in the source and lowers their confidence', () => {
    expect(constant('boss-hp')?.provenance).toMatchObject({
      confidence: 'low',
      status: 'detected',
    });
    expect(report.unverified).toEqual([
      { ref: 'const:boss-hp', chunk: 'docs/design.md#L10-13', quote: 'The boss has 900 HP.' },
      { ref: 'gap:gap-price', chunk: 'docs/design.md#L10-13', quote: 'The price is not decided.' },
    ]);
    expect(model.gaps.find((g) => g.id === 'gap-unverified-evidence')?.related).toEqual([
      'const:boss-hp',
    ]);
  });

  it('drops what is incomplete or invalid, and says so in a gap', () => {
    expect(constant('unknown-price')).toBeUndefined();
    expect(model.actions.map((a) => a.id)).not.toContain('broken');
    expect(model.monetization.placements.map((p) => p.id)).toEqual(['rewarded-revive']);
    const dropped = report.dropped.map((d) => d.ref);
    expect(dropped).toEqual(
      expect.arrayContaining(['const:unknown-price', 'action:broken', 'placement:banner-play']),
    );
    expect(report.dropped.find((d) => d.ref === 'action:broken')?.reason).toMatch(
      /EXPR_UNKNOWN_IDENTIFIER.*coinz/,
    );
    expect(report.dropped.find((d) => d.ref === 'placement:banner-play')?.reason).toMatch(
      /PLACEMENT_IN_FORBIDDEN_STATE/,
    );
    expect(model.gaps.find((g) => g.id === 'gap-extraction-dropped')?.question).toMatch(
      /placement:banner-play/,
    );
    expect(model.gaps.find((g) => g.id === 'gap-price')?.related).toEqual(['action:revive']);
  });

  it('gives distinct ids to different transitions proposed under the same id', () => {
    expect(model.stateMachine.transitions.map((t) => [t.id, t.from, t.to, t.outcome])).toEqual([
      ['go', 'state:home', 'state:play', undefined],
      ['go-2', 'state:play', 'state:home', 'win'],
      ['back', 'state:play', 'state:home', 'lose'],
    ]);
  });

  it('turns unsupported items into assumptions and covers every assumption with a gap', () => {
    expect(model.variables[0]?.provenance).toMatchObject({
      source: 'gamex:assumed',
      status: 'assumed',
      confidence: 'low',
    });
    expect(report.noEvidence).toEqual(expect.arrayContaining(['var:last-result', 'state:home']));
    const warnings = validateGameModel(model).issues.filter(
      (i) => i.code === 'ASSUMED_WITHOUT_GAP',
    );
    expect(warnings).toEqual([]);
  });

  it('adds default personas, KPIs and economy flows', () => {
    expect(model.personas.map((p) => p.share)).toEqual([0.6, 0.3, 0.1]);
    expect(model.kpis.map((k) => k.id)).toEqual([
      'coins-balance',
      'coins-inflation',
      'coins-faucet-sink',
      'churn-risk',
      'rewarded-per-dau',
      'rewarded-opt-in',
    ]);
    expect(model.flows.map((f) => [f.id, f.kind, f.actions])).toEqual([
      ['coins-sources', 'source', ['action:play-run']],
      ['coins-wallet', 'pool', []],
    ]);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(assembleCandidate(tinyOutputs(), CHUNKS).model)).toBe(
      JSON.stringify(model),
    );
  });
});

describe('review', () => {
  const { model } = assembleCandidate(tinyOutputs(), CHUNKS);

  it('leaves undecided items out and lists them as pending', () => {
    const states = ['state:home', 'state:play'].map((ref) => ({
      ref,
      decision: 'approve' as const,
    }));
    const { model: out, summary } = promote(model, { ...EMPTY_LEDGER, decisions: states });
    expect(out.constants).toEqual([]);
    expect(out.stateMachine.states.map((s) => s.provenance.status)).toEqual(['assumed', 'assumed']);
    expect(summary.pending).toContain('const:max-revives');
    expect(reviewItems(model, EMPTY_LEDGER).every((i) => i.decision === 'pending')).toBe(true);
    expect(() => promote(model, EMPTY_LEDGER)).toThrow(
      /incomplete .*needs at least one state.*item\(s\) have no decision/,
    );
  });

  it('applies approve, assume, edit and reject, with cascades and stale refs', () => {
    let ledger: ReviewLedger = { ...EMPTY_LEDGER, default: 'approve' };
    ledger = decide(ledger, 'const:coins-per-win', 'edit', {
      set: { value: 60, description: 'Raised after playtest' },
    });
    ledger = decide(ledger, 'const:max-revives', 'assume');
    ledger = decide(ledger, 'action:revive', 'reject');
    ledger = decide(ledger, 'const:gone', 'approve');
    const { model: out, summary, issues } = promote(model, ledger);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(out.constants.find((c) => c.id === 'coins-per-win')).toMatchObject({
      value: 60,
      description: 'Raised after playtest',
      provenance: { status: 'edited' },
    });
    expect(out.constants.find((c) => c.id === 'max-revives')?.provenance.status).toBe('assumed');
    expect(out.constants.find((c) => c.id === 'boss-hp')?.provenance.status).toBe('confirmed');
    expect(out.actions.map((a) => a.id)).toEqual(['play-run']);
    expect(summary).toMatchObject({ rejected: 1, edited: 1, assumed: 1, stale: ['const:gone'] });
    expect(summary.cascaded.map((d) => d.ref)).toContain('placement:rewarded-revive');
    expect(ledger.decisions.map((d) => d.ref)).toEqual([
      'action:revive',
      'const:coins-per-win',
      'const:gone',
      'const:max-revives',
    ]);
  });

  it('refuses edits that change the id', () => {
    const ledger = decide({ ...EMPTY_LEDGER, default: 'approve' }, 'const:boss-hp', 'edit', {
      set: { id: 'other' },
    });
    expect(() => promote(model, ledger)).toThrow(/cannot change "id"/);
  });
});

describe('review after re-extraction', () => {
  it('asks again about items that changed since their decision', () => {
    const first = assembleCandidate(tinyOutputs(), CHUNKS).model;
    const item = reviewItems(first, EMPTY_LEDGER).find((i) => i.ref === 'const:coins-per-win');
    if (item === undefined) throw new Error('missing item');
    let ledger: ReviewLedger = { ...EMPTY_LEDGER, default: 'approve' };
    ledger = decide(ledger, item.ref, 'reject', { hash: item.hash });
    expect(promote(first, ledger).model.constants.map((c) => c.id)).not.toContain('coins-per-win');

    const outputs = tinyOutputs();
    const coins = outputs.inventory[0]?.constants.find((c) => c.id === 'coins-per-win');
    if (coins !== undefined) coins.value = 75;
    const second = assembleCandidate(outputs, CHUNKS).model;
    const { model, summary } = promote(second, ledger);
    expect(summary.changed).toEqual(['const:coins-per-win']);
    expect(summary.pending).toContain('const:coins-per-win');
    expect(model.constants.map((c) => c.id)).not.toContain('coins-per-win');
    expect(reviewItems(second, ledger).find((i) => i.ref === 'const:coins-per-win')?.decision).toBe(
      'pending',
    );
    expect(itemHash({ id: 'x', provenance: { status: 'detected' } })).toBe(
      itemHash({ id: 'x', provenance: { status: 'confirmed' } }),
    );
  });
});
