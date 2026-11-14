/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return --
   The broken-model corpus mutates models through `any` on purpose: the point is to produce invalid shapes. */
import { describe, expect, it } from 'vitest';
import {
  canonicalStringify,
  formatIssue,
  validateGameModel,
  type GameModel,
  type Issue,
} from '@gamex/model';
import { minimalModel } from './helpers/minimal-model.ts';

type Mutable = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- test mutations

function lineOf(text: string, line: number | undefined): string {
  return line === undefined ? '' : (text.split('\n')[line - 1] ?? '');
}

describe('validateGameModel on valid input', () => {
  it('accepts the minimal model with no issues', () => {
    const r = validateGameModel(canonicalStringify(minimalModel()));
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.model?.meta.name).toBe('Mini');
  });

  it('accepts an already-parsed object (no line numbers then)', () => {
    const m = minimalModel() as Mutable;
    m.constants[0].value = 999;
    const r = validateGameModel(m);
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatchObject({
      code: 'CONSTANT_OUT_OF_RANGE',
      path: '/constants/0/value',
    });
    expect(r.issues[0]?.line).toBeUndefined();
  });
});

interface Case {
  readonly name: string;
  readonly mutate: (m: Mutable) => void;
  readonly code: string;
  readonly path: string;
  /** Text that must appear on the reported source line — proves the line number is right. */
  readonly line: string;
  readonly message?: RegExp;
  readonly hint?: RegExp;
  readonly severity?: 'error' | 'warning';
}

const CASES: Case[] = [
  {
    name: 'missing section',
    mutate: (m) => delete m.flows,
    code: 'SCHEMA_INVALID_TYPE',
    path: '/flows',
    line: '{',
  },
  {
    name: 'unknown top-level field',
    mutate: (m) => (m.extras = 1),
    code: 'SCHEMA_UNRECOGNIZED_KEYS',
    path: '/extras',
    line: '"extras": 1',
    hint: /Remove it/,
  },
  {
    name: 'typo in a field name',
    mutate: (m) => (m.constants[1].balancefile = 'x'),
    code: 'SCHEMA_UNRECOGNIZED_KEYS',
    path: '/constants/1/balancefile',
    line: '"balancefile"',
  },
  {
    name: 'id not kebab-case',
    mutate: (m) => (m.resources[0].id = 'Coins'),
    code: 'SCHEMA_INVALID_FORMAT',
    path: '/resources/0/id',
    line: '"id": "Coins"',
    message: /kebab-case/,
  },
  {
    name: 'wrong enum value',
    mutate: (m) => (m.resources[0].kind = 'gems'),
    code: 'SCHEMA_INVALID_VALUE',
    path: '/resources/0/kind',
    line: '"kind": "gems"',
  },
  {
    name: 'wrong value type',
    mutate: (m) => (m.resources[0].starting = '0'),
    code: 'SCHEMA_INVALID_TYPE',
    path: '/resources/0/starting',
    line: '"starting": "0"',
  },
  {
    name: 'reference without prefix',
    mutate: (m) => (m.flows[0].resource = 'coins'),
    code: 'SCHEMA_INVALID_FORMAT',
    path: '/flows/0/resource',
    line: '"resource": "coins"',
    message: /res:<id>/,
  },
  {
    name: 'excerpt too long',
    mutate: (m) => (m.entities[0].provenance.excerpt = 'x'.repeat(201)),
    code: 'SCHEMA_TOO_BIG',
    path: '/entities/0/provenance/excerpt',
    line: '"excerpt": "xxx',
  },
  {
    name: 'bad error code',
    mutate: (m) => (m.actions[0].errorCode = 'oops'),
    code: 'SCHEMA_INVALID_FORMAT',
    path: '/actions/0/errorCode',
    line: '"errorCode": "oops"',
    message: /UPPER_SNAKE_CASE/,
  },
  {
    name: 'unsupported schema version',
    mutate: (m) => (m.meta.schemaVersion = '9.0.0'),
    code: 'SCHEMA_VERSION_UNSUPPORTED',
    path: '/meta/schemaVersion',
    line: '"schemaVersion": "9.0.0"',
    hint: /Upgrade/,
  },
  {
    name: 'duplicate id',
    mutate: (m) => (m.constants[1].id = 'hero-hp'),
    code: 'DUPLICATE_ID',
    path: '/constants/1/id',
    line: '"id": "hero-hp"',
  },
  {
    name: 'key does not match id',
    mutate: (m) => (m.constants[0].key = 'heroHP'),
    code: 'KEY_MISMATCH',
    path: '/constants/0/key',
    line: '"key": "heroHP"',
    hint: /heroHp/,
  },
  {
    name: 'key collision between a constant and a variable',
    mutate: (m) => m.variables.push({ ...m.variables[1], id: 'reward' }),
    code: 'KEY_COLLISION',
    path: '/variables/2/id',
    line: '"id": "reward"',
  },
  {
    name: 'key collides with a built-in name',
    mutate: (m) => (m.constants[1].id = 'now'),
    code: 'KEY_RESERVED',
    path: '/constants/1/id',
    line: '"id": "now"',
  },
  {
    name: 'unknown state reference',
    mutate: (m) => (m.stateMachine.transitions[0].to = 'state:gmae'),
    code: 'UNKNOWN_REFERENCE',
    path: '/stateMachine/transitions/0/to',
    line: '"to": "state:gmae"',
    hint: /Did you mean "state:game"/,
  },
  {
    name: 'unknown constant in entity attribute',
    mutate: (m) => (m.entities[0].attributes.hp = 'const:hero-health'),
    code: 'UNKNOWN_REFERENCE',
    path: '/entities/0/attributes/hp',
    line: '"hp": "const:hero-health"',
  },
  {
    name: 'unknown outcome',
    mutate: (m) => (m.stateMachine.transitions[1].outcome = 'victory'),
    code: 'UNKNOWN_OUTCOME',
    path: '/stateMachine/transitions/1/outcome',
    line: '"outcome": "victory"',
  },
  {
    name: 'outcome on a ui transition',
    mutate: (m) => (m.stateMachine.transitions[0].outcome = 'win'),
    code: 'OUTCOME_WITHOUT_ACTION',
    path: '/stateMachine/transitions/0/outcome',
    line: '"outcome": "win"',
  },
  {
    name: 'expression syntax error',
    mutate: (m) => (m.actions[2].preconditions[0] = 'tier < '),
    code: 'EXPR_UNEXPECTED_TOKEN',
    path: '/actions/2/preconditions/0',
    line: '"tier < "',
    message: /in "tier < " at character 8/,
  },
  {
    name: 'unknown identifier in expression',
    mutate: (m) => (m.actions[2].preconditions[0] = 'teir < 10'),
    code: 'EXPR_UNKNOWN_IDENTIFIER',
    path: '/actions/2/preconditions/0',
    line: '"teir < 10"',
    hint: /Did you mean "tier"/,
  },
  {
    name: 'precondition that is not a boolean',
    mutate: (m) => (m.actions[2].preconditions[0] = 'tier + 1'),
    code: 'EXPR_TYPE_MISMATCH',
    path: '/actions/2/preconditions/0',
    line: '"tier + 1"',
  },
  {
    name: 'unknown enum value',
    mutate: (m) => (m.actions[1].preconditions[0] = 'result == "lost"'),
    code: 'EXPR_UNKNOWN_ENUM_VALUE',
    path: '/actions/1/preconditions/0',
    line: 'result == \\"lost\\"',
  },
  {
    name: 'assigning an unknown enum value',
    mutate: (m) => (m.actions[1].effects[0].value = '"revived"'),
    code: 'EXPR_UNKNOWN_ENUM_VALUE',
    path: '/actions/1/effects/0/value',
    line: '"value": "\\"revived\\""',
  },
  {
    name: 'curve used as a value',
    mutate: (m) => (m.actions[2].costs[0].amount = 'cost * 2'),
    code: 'EXPR_CURVE_AS_VALUE',
    path: '/actions/2/costs/0/amount',
    line: '"amount": "cost * 2"',
    hint: /curve\(cost, n\)/,
  },
  {
    name: 'eligible() with an unknown placement',
    mutate: (m) => (m.stateMachine.transitions[4].guard = 'eligible("intersitial")'),
    code: 'EXPR_UNKNOWN_PLACEMENT',
    path: '/stateMachine/transitions/4/guard',
    line: 'eligible(\\"intersitial\\")',
  },
  {
    name: 'aggregate invariant using a model variable',
    mutate: (m) => (m.invariants[1].expr = 'tier >= 0'),
    code: 'EXPR_UNKNOWN_IDENTIFIER',
    path: '/invariants/1/expr',
    line: '"expr": "tier >= 0"',
  },
  {
    name: 'constant above max',
    mutate: (m) => (m.constants[0].value = 250),
    code: 'CONSTANT_OUT_OF_RANGE',
    path: '/constants/0/value',
    line: '"value": 250',
  },
  {
    name: 'min greater than max',
    mutate: (m) => (m.constants[1].min = 200),
    code: 'CONSTANT_RANGE',
    path: '/constants/1/min',
    line: '"min": 200',
  },
  {
    name: 'step does not divide the range',
    mutate: (m) => (m.constants[1].step = 7),
    code: 'CONSTANT_STEP',
    path: '/constants/1/step',
    line: '"step": 7',
  },
  {
    name: 'integer constant with a fraction',
    mutate: (m) => (m.constants[0].value = 100.5),
    code: 'CONSTANT_NOT_INTEGER',
    path: '/constants/0/value',
    line: '"value": 100.5',
  },
  {
    name: 'resource starts above its cap',
    mutate: (m) => (m.resources[0].starting = 5000),
    code: 'RESOURCE_START_ABOVE_CAP',
    path: '/resources/0/starting',
    line: '"starting": 5000',
  },
  {
    name: 'variable initial of the wrong type',
    mutate: (m) => (m.variables[1].initial = true),
    code: 'VARIABLE_INITIAL_TYPE',
    path: '/variables/1/initial',
    line: '"initial": true',
  },
  {
    name: 'enum initial not in enumValues',
    mutate: (m) => (m.variables[0].initial = 'pending'),
    code: 'VARIABLE_INITIAL_TYPE',
    path: '/variables/0/initial',
    line: '"initial": "pending"',
  },
  {
    name: 'persona shares do not add up',
    mutate: (m) => (m.personas[0].share = 0.8),
    code: 'PERSONA_SHARES',
    path: '/personas',
    line: '"personas": [',
  },
  {
    name: 'distribution min above max',
    mutate: (m) => (m.personas[0].sessionLengthSeconds.min = 900),
    code: 'DISTRIBUTION_RANGE',
    path: '/personas/0/sessionLengthSeconds/min',
    line: '"min": 900',
  },
  {
    name: 'piecewise segment order',
    mutate: (m) =>
      (m.constants[5].value = {
        type: 'piecewise',
        params: {
          segments: [
            { upTo: 5, curve: { type: 'linear', params: { base: 1, perStep: 1 } } },
            { upTo: 3, curve: { type: 'linear', params: { base: 1, perStep: 1 } } },
          ],
        },
      }),
    code: 'CURVE_PIECEWISE_ORDER',
    path: '/constants/5/value/params/segments/1/upTo',
    line: '"upTo": 3',
  },
  {
    name: 'UI ad in a forbidden state',
    mutate: (m) =>
      m.monetization.placements.push({
        id: 'banner-game',
        format: 'banner',
        trigger: { state: 'state:game' },
        eligibility: [],
        provenance: m.entities[0].provenance,
      }),
    code: 'PLACEMENT_IN_FORBIDDEN_STATE',
    path: '/monetization/placements/2/trigger/state',
    line: '"state": "state:game"',
  },
  {
    name: 'rewarded ad triggered from gameplay',
    mutate: (m) => (m.stateMachine.transitions[3].from = 'state:game'),
    code: 'PLACEMENT_IN_FORBIDDEN_STATE',
    path: '/stateMachine/transitions/3/trigger',
    line: '"trigger": "action:revive"',
  },
  {
    name: 'JSON syntax error',
    mutate: () => undefined,
    code: 'JSON_SYNTAX',
    path: '',
    line: '"meta": {',
  },
];

describe('validateGameModel on broken models', () => {
  it('has at least 25 cases', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(25);
  });

  it.each(CASES)('$name → $code at $path', (c) => {
    const m = minimalModel() as Mutable;
    c.mutate(m);
    let text = canonicalStringify(m);
    if (c.code === 'JSON_SYNTAX') text = text.replace('"meta": {', '"meta": {,');
    const r = validateGameModel(text, { source: 'game-model.json' });
    const issue = r.issues.find((i: Issue) => i.code === c.code && i.path === c.path);
    expect(issue, `got: ${r.issues.map(formatIssue).join('\n')}`).toBeDefined();
    if (issue === undefined) return;
    expect(issue.severity).toBe(c.severity ?? 'error');
    expect(r.ok).toBe((c.severity ?? 'error') === 'warning');
    expect(issue.source).toBe('game-model.json');
    expect(lineOf(text, issue.line)).toContain(c.line);
    expect(issue.column).toBeGreaterThan(0);
    if (c.message) expect(issue.message).toMatch(c.message);
    if (c.hint) expect(issue.hint).toMatch(c.hint);
  });

  it('points expression errors at the offending character', () => {
    const m = minimalModel() as Mutable;
    m.actions[2].preconditions[0] = 'tier < teir';
    const text = canonicalStringify(m);
    const issue = validateGameModel(text).issues[0];
    if (issue?.line === undefined || issue.column === undefined)
      throw new Error('expected a located issue');
    expect(lineOf(text, issue.line).slice(issue.column - 1, issue.column + 3)).toBe('teir');
  });

  it('collects every issue instead of stopping at the first', () => {
    const m = minimalModel() as Mutable;
    m.constants[0].value = 999;
    m.actions[2].preconditions[0] = 'teir < 10';
    m.stateMachine.transitions[0].to = 'state:nowhere';
    const codes = validateGameModel(m).issues.map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'CONSTANT_OUT_OF_RANGE',
        'EXPR_UNKNOWN_IDENTIFIER',
        'UNKNOWN_REFERENCE',
      ]),
    );
  });

  it('reports a non-object input as a schema error', () => {
    expect(validateGameModel('[]').issues[0]).toMatchObject({
      code: 'SCHEMA_INVALID_TYPE',
      path: '',
    });
  });
});

describe('warnings', () => {
  const warningsOf = (mutate: (m: Mutable) => void): string[] => {
    const m = minimalModel() as Mutable;
    mutate(m);
    const r = validateGameModel(m);
    expect(r.ok).toBe(true);
    return r.issues.filter((i) => i.severity === 'warning').map((i) => `${i.code} ${i.path}`);
  };

  it('flags unused constants', () => {
    expect(warningsOf((m) => m.constants.push({ ...m.constants[1], id: 'unused-thing' }))).toEqual([
      'UNUSED_CONSTANT /constants/6',
    ]);
  });

  it('flags resources that never change', () => {
    expect(
      warningsOf((m) =>
        m.resources.push({
          id: 'gems',
          kind: 'hard',
          starting: 0,
          provenance: m.resources[0].provenance,
        }),
      ),
    ).toEqual(['RESOURCE_NEVER_CHANGES /resources/1']);
  });

  it('flags assumed items that no gap asks about, and stops once a gap covers them', () => {
    const assume = (m: Mutable) =>
      (m.constants[1].provenance = { ...m.constants[1].provenance, status: 'assumed' });
    expect(warningsOf(assume)).toEqual(['ASSUMED_WITHOUT_GAP /constants/1']);
    expect(
      warningsOf((m) => {
        assume(m);
        m.gaps.push({
          id: 'reward-amount',
          kind: 'assumption',
          question: 'Confirm the reward?',
          related: ['const:reward'],
          blocking: false,
          provenance: m.constants[0].provenance,
        });
      }),
    ).toEqual([]);
  });

  it('flags revenue KPIs without revenue assumptions', () => {
    expect(
      warningsOf((m) =>
        m.kpis.push({ id: 'arpdau', metric: 'arpdau', provenance: m.kpis[0].provenance }),
      ),
    ).toEqual(['REVENUE_KPI_WITHOUT_ASSUMPTIONS /kpis/1/metric']);
  });

  it('allows in-world placements during gameplay', () => {
    expect(
      warningsOf((m) =>
        m.monetization.placements.push({
          id: 'billboard',
          format: 'banner',
          inWorld: true,
          trigger: { state: 'state:game' },
          eligibility: [],
          provenance: m.entities[0].provenance,
        }),
      ),
    ).toEqual([]);
  });
});

describe('formatIssue', () => {
  it('renders file:line:col, severity, code, path, message and hint', () => {
    const issue: Issue = {
      severity: 'error',
      code: 'X',
      path: '/a',
      message: 'bad',
      hint: 'fix it',
      source: 'f.json',
      line: 3,
      column: 7,
    };
    expect(formatIssue(issue)).toBe('f.json:3:7: error X at /a: bad — fix it');
    expect(formatIssue({ severity: 'warning', code: 'Y', path: '', message: 'm' })).toBe(
      'warning Y at /: m',
    );
  });
});

export type { GameModel };
