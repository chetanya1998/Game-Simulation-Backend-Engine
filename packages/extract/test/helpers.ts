import type { Chunk } from '@gamex/ingest';
import type { PassOutputs } from '@gamex/extract';

export const DESIGN = `## 3. Ads
Revive at most **2 times** per run.
Players get 50 coins per win.
Shown only after a win.`;

export const CONFIG = `{
  "maxRevives": 3,
  "coinsPerWin": 50
}`;

export const CHUNKS: Chunk[] = [
  {
    id: 'docs/design.md#L10-13',
    path: 'docs/design.md',
    kind: 'design',
    startLine: 10,
    endLine: 13,
    heading: '3. Ads',
    text: DESIGN,
  },
  {
    id: 'config/game.json#L1-4',
    path: 'config/game.json',
    kind: 'config',
    startLine: 1,
    endLine: 4,
    text: CONFIG,
  },
];

const node = (id: string, chunk: string, quote: string, assumed = false) => ({
  id,
  name: id,
  description: null,
  assumed,
  evidence: chunk === '' ? [] : [{ chunk, quote }],
});

/** A tiny two-screen game proposed by the four passes. */
export function tinyOutputs(): PassOutputs {
  return {
    inventory: [
      {
        meta: { name: 'Tiny', genre: 'arcade', platforms: ['iOS'], targetMarkets: ['US'] },
        entities: [],
        resources: [
          {
            ...node('coins', 'docs/design.md#L10-13', 'Players get 50 coins per win.'),
            kind: 'soft',
            starting: null,
            cap: null,
            unit: null,
          },
        ],
        constants: [
          {
            ...node('max-revives', 'docs/design.md#L10-13', 'Revive at most **2 times** per run.'),
            unit: 'count',
            value: 2,
            curve: null,
            min: null,
            max: null,
            integer: true,
            balanceFile: 'ads',
          },
          {
            ...node('max-revives', 'config/game.json#L1-4', '"maxRevives": 3'),
            unit: 'count',
            value: 3,
            curve: null,
            min: null,
            max: null,
            integer: true,
            balanceFile: 'ads',
          },
          {
            ...node('coins-per-win', 'docs/design.md#L10-13', 'Players get 50 coins per win.'),
            unit: 'coins',
            value: 50,
            curve: null,
            min: null,
            max: null,
            integer: true,
            balanceFile: 'Economy',
          },
          {
            ...node('boss-hp', 'docs/design.md#L10-13', 'The boss has 900 HP.'),
            unit: 'hp',
            value: 900,
            curve: null,
            min: null,
            max: null,
            integer: true,
            balanceFile: 'combat',
          },
          {
            ...node('unknown-price', '', ''),
            unit: 'usd',
            value: null,
            curve: null,
            min: null,
            max: null,
            integer: false,
            balanceFile: 'iap',
          },
        ],
        variables: [
          {
            ...node('last-result', '', '', true),
            scope: 'player',
            type: 'enum',
            initial: 'none',
            enumValues: ['none', 'win', 'lose'],
            min: null,
            max: null,
          },
        ],
      },
    ],
    flow: [
      {
        constants: [],
        variables: [],
        initialState: 'state:Home',
        states: [
          { ...node('Home', '', '', true), kind: 'menu', code: null, durationSeconds: null },
          { ...node('play', '', '', true), kind: 'gameplay', code: null, durationSeconds: '60' },
        ],
        actions: [
          {
            ...node('play-run', 'docs/design.md#L10-13', 'Players get 50 coins per win.'),
            actor: 'player',
            preconditions: [],
            costs: [],
            effects: [],
            limits: [],
            cooldownSeconds: null,
            outcomes: [
              {
                id: 'win',
                weight: '1',
                effects: [
                  { op: 'add', target: 'res:coins', value: 'coinsPerWin' },
                  { op: 'set', target: 'var:last-result', value: '"win"' },
                ],
              },
              {
                id: 'lose',
                weight: '1',
                effects: [{ op: 'set', target: 'var:last-result', value: '"lose"' }],
              },
            ],
            durationSeconds: null,
            errorCode: 'cannot play',
          },
          {
            ...node('revive', 'docs/design.md#L10-13', 'Revive at most 2 times per run.'),
            actor: 'ad-sdk',
            preconditions: ['lastResult == "lose"'],
            costs: [],
            effects: [],
            limits: [{ max: 'maxRevives', per: 'mission', errorCode: null }],
            cooldownSeconds: null,
            outcomes: [],
            durationSeconds: null,
            errorCode: 'REVIVE_NOT_AVAILABLE',
          },
          {
            ...node('broken', 'docs/design.md#L10-13', 'Players get 50 coins per win.'),
            actor: 'player',
            preconditions: ['coinz > 3'],
            costs: [],
            effects: [],
            limits: [],
            cooldownSeconds: null,
            outcomes: [],
            durationSeconds: null,
            errorCode: 'BROKEN',
          },
        ],
        transitions: [
          {
            ...node('go', '', '', true),
            from: 'state:home',
            to: 'state:play',
            trigger: 'ui',
            outcome: null,
            guard: null,
            effects: [],
            beginsMission: true,
            endsMission: false,
          },
          {
            ...node('go', '', '', true),
            from: 'state:play',
            to: 'state:home',
            trigger: 'action:play-run',
            outcome: 'win',
            guard: null,
            effects: [],
            beginsMission: false,
            endsMission: true,
          },
          {
            ...node('back', '', '', true),
            from: 'state:play',
            to: 'state:home',
            trigger: 'action:play-run',
            outcome: 'lose',
            guard: null,
            effects: [],
            beginsMission: false,
            endsMission: true,
          },
        ],
      },
    ],
    monetization: [
      {
        constants: [],
        variables: [],
        placements: [
          {
            ...node('rewarded-revive', 'docs/design.md#L10-13', 'Revive at most 2 times per run.'),
            format: 'rewarded',
            trigger: 'action:revive',
            eligibility: [],
            caps: [],
            cooldownSeconds: null,
            reward: [],
            onShow: [],
            inWorld: false,
          },
          {
            ...node('banner-play', 'docs/design.md#L10-13', 'Shown only after a win.'),
            format: 'banner',
            trigger: 'state:play',
            eligibility: [],
            caps: [],
            cooldownSeconds: null,
            reward: [],
            onShow: [],
            inWorld: false,
          },
        ],
        rules: [],
        invariants: [],
        forbiddenStates: ['state:play'],
      },
    ],
    gaps: [
      {
        gaps: [
          {
            ...node('gap-price', 'docs/design.md#L10-13', 'The price is not decided.'),
            kind: 'missing',
            question: 'What is the price?',
            related: ['const:unknown-price', 'action:revive'],
            blocking: true,
          },
        ],
      },
    ],
  };
}
