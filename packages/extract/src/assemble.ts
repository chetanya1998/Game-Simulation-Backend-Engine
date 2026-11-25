import type { Chunk } from '@gamex/ingest';
import {
  SCHEMA_VERSION,
  type Action,
  type Constant,
  type Effect,
  type Entity,
  type GameModel,
  type Gap,
  type Invariant,
  type Issue,
  type Limit,
  type Placement,
  type Provenance,
  type Resource,
  type Rule,
  type State,
  type Transition,
  type Variable,
} from '@gamex/model';
import { defaultFlows, defaultKpis, defaultPersonas } from './defaults.js';
import { derivedGaps, type Conflict } from './gaps.js';

export type { Conflict } from './gaps.js';
import { idToKey, toId, toRef } from './ids.js';
import { textStatesNumber, verifyEvidence, type VerifiedEvidence } from './provenance.js';
import { repairModel, type Dropped } from './repair.js';
import type {
  ConstantProposal,
  CurveProposal,
  EffectProposal,
  Evidence,
  LimitProposal,
  PassOutputs,
  VariableProposal,
} from './schemas.js';

export interface AssemblyReport {
  /** Proposal ids that were not valid ids and were normalized. */
  readonly aliases: readonly { readonly from: string; readonly to: string }[];
  /** Same id, different values: the code/config value wins; the rest are kept as alternatives. */
  readonly conflicts: readonly Conflict[];
  /** Quotes that could not be found in the cited chunk or file. */
  readonly unverified: readonly {
    readonly ref: string;
    readonly chunk: string;
    readonly quote: string;
  }[];
  /** Numbers that do not appear in the cited source line. */
  readonly valueMismatches: readonly {
    readonly ref: string;
    readonly value: number;
    readonly excerpt: string;
  }[];
  /** Items without any evidence, kept as assumptions. */
  readonly noEvidence: readonly string[];
  /** Removed because they were incomplete or invalid. */
  readonly dropped: readonly Dropped[];
  /** Proposals that were merged into an item with the same id. */
  readonly merged: number;
  readonly counts: Readonly<Record<string, number>>;
}

export interface Candidate {
  readonly model: GameModel;
  readonly report: AssemblyReport;
  /** Validation warnings left on the candidate. */
  readonly issues: readonly Issue[];
}

interface Ctx {
  readonly chunks: ReadonlyMap<string, Chunk>;
  readonly byPath: ReadonlyMap<string, readonly Chunk[]>;
  readonly aliases: Map<string, string>;
  readonly unverified: { ref: string; chunk: string; quote: string }[];
  readonly valueMismatches: { ref: string; value: number; excerpt: string }[];
  readonly noEvidence: string[];
  readonly dropped: Dropped[];
  readonly conflicts: Conflict[];
  merged: number;
}

const ALL_PREFIXES = [
  'ent',
  'res',
  'const',
  'var',
  'action',
  'rule',
  'state',
  'transition',
  'flow',
  'placement',
  'persona',
  'kpi',
  'inv',
  'gap',
];
const KIND_RANK: Record<string, number> = { config: 0, code: 1, design: 2 };
const MATCH_RANK = { exact: 0, fuzzy: 1, missing: 2 } as const;

function normId(ctx: Ctx, raw: string): string {
  const id = toId(raw);
  if (id !== raw) ctx.aliases.set(raw, id);
  return id;
}

/** Normalizes a reference; leaves it as written when it cannot be (the validator then reports it). */
function ref(raw: string, allowed: readonly string[]): string {
  return toRef(raw, allowed) ?? raw;
}

function code(raw: string | null | undefined, fallback: string): string {
  const c = (raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[A-Z]/.test(c) ? c : fallback;
}

function effect(e: EffectProposal): Effect {
  return { op: e.op, target: ref(e.target, ['var', 'res']), value: e.value };
}

function limit(l: LimitProposal): Limit {
  return {
    max: l.max,
    per: l.per,
    ...(l.errorCode === null ? {} : { errorCode: code(l.errorCode, 'LIMIT_REACHED') }),
  };
}

function verified(ctx: Ctx, nodeRef: string, evidence: readonly Evidence[]): VerifiedEvidence[] {
  const out = evidence.map((e) => verifyEvidence(e, ctx.chunks, ctx.byPath));
  const sorted = out.sort((a, b) => MATCH_RANK[a.match] - MATCH_RANK[b.match]);
  const best = sorted[0];
  const cited = evidence[0];
  if (best?.match === 'missing' && cited !== undefined) {
    ctx.unverified.push({ ref: nodeRef, chunk: cited.chunk, quote: cited.quote });
  }
  return sorted;
}

function provenance(
  ctx: Ctx,
  nodeRef: string,
  evidence: readonly VerifiedEvidence[],
  assumed: boolean,
  value?: number,
): Provenance {
  const best = evidence[0];
  if (best === undefined) {
    ctx.noEvidence.push(nodeRef);
    return {
      source: 'gamex:assumed',
      location: '',
      excerpt: 'Not stated in the inputs; proposed by the extraction as an assumption.',
      confidence: 'low',
      status: 'assumed',
    };
  }
  let confidence: Provenance['confidence'] =
    best.match === 'exact' ? 'high' : best.match === 'fuzzy' ? 'medium' : 'low';
  if (value !== undefined && best.match !== 'missing' && !textStatesNumber(best.excerpt, value)) {
    ctx.valueMismatches.push({ ref: nodeRef, value, excerpt: best.excerpt });
    confidence = confidence === 'high' ? 'medium' : 'low';
  }
  return {
    source: best.source,
    location: best.location,
    excerpt: best.excerpt,
    confidence,
    status: assumed ? 'assumed' : 'detected',
  };
}

function base(
  ctx: Ctx,
  prefix: string,
  p: { id: string; name: string; description: string | null },
): { id: string; name: string; description?: string; ref: string } {
  const id = normId(ctx, p.id);
  return {
    id,
    name: p.name,
    ...(p.description === null || p.description.trim() === ''
      ? {}
      : { description: p.description }),
    ref: `${prefix}:${id}`,
  };
}

/** Groups proposals by normalized id, keeping first-seen order. */
function group<T extends { id: string }>(ctx: Ctx, items: readonly T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const id = normId(ctx, item.id);
    const g = groups.get(id);
    if (g === undefined) groups.set(id, [item]);
    else {
      g.push(item);
      ctx.merged++;
    }
  }
  return [...groups.values()];
}

/**
 * Like `group`, but proposals that share an id while describing different things (two transitions
 * named "continue" from different screens) get distinct ids ("continue-2").
 */
function groupBySignature<T extends { id: string }>(
  ctx: Ctx,
  items: readonly T[],
  signature: (t: T) => string,
): T[][] {
  const byId = new Map<string, Map<string, T[]>>();
  for (const item of items) {
    const id = normId(ctx, item.id);
    const sigs = byId.get(id) ?? new Map<string, T[]>();
    byId.set(id, sigs);
    const sig = signature(item);
    const g = sigs.get(sig);
    if (g === undefined) sigs.set(sig, [item]);
    else {
      g.push(item);
      ctx.merged++;
    }
  }
  const out: T[][] = [];
  for (const [id, sigs] of byId) {
    let n = 0;
    for (const g of sigs.values()) {
      n++;
      out.push(n === 1 ? g : g.map((t) => ({ ...t, id: `${id}-${String(n)}` })));
    }
  }
  return out;
}

function curveValue(c: CurveProposal): Constant['value'] | undefined {
  const common = {
    ...(c.rounding === null ? {} : { rounding: c.rounding }),
  };
  const from = c.from === null ? {} : { from: Math.trunc(c.from) };
  if (c.type === 'linear' && c.base !== null && c.perStep !== null) {
    return { type: 'linear', params: { base: c.base, perStep: c.perStep, ...from }, ...common };
  }
  if (c.type === 'geometric' && c.base !== null && c.ratio !== null) {
    return { type: 'geometric', params: { base: c.base, ratio: c.ratio, ...from }, ...common };
  }
  if (c.type === 'table' && c.values !== null && c.values.length > 0) {
    return { type: 'table', params: { values: c.values, ...from }, ...common };
  }
  return undefined;
}

function describeValue(v: Constant['value']): string {
  if (typeof v === 'number') return String(v);
  switch (v.type) {
    case 'linear':
      return `linear(${String(v.params.base)} + ${String(v.params.perStep)}/tier)`;
    case 'geometric':
      return `geometric(${String(v.params.base)} × ${String(v.params.ratio)}^tier)`;
    case 'table':
      return `table[${v.params.values.join(', ')}]`;
    case 'piecewise':
      return 'piecewise';
  }
}

function constantFrom(ctx: Ctx, proposals: readonly ConstantProposal[]): Constant | undefined {
  const first = proposals[0];
  if (first === undefined) return undefined;
  const b = base(ctx, 'const', first);
  const options = proposals.map((p, order) => {
    const ev = verified(ctx, b.ref, p.evidence);
    const value = p.value ?? (p.curve === null ? undefined : curveValue(p.curve));
    const kind = ev[0]?.chunk?.kind;
    return { p, ev, value, order, rank: kind === undefined ? 3 : (KIND_RANK[kind] ?? 3) };
  });
  const usable = options
    .filter((o) => o.value !== undefined)
    .sort((x, y) => x.rank - y.rank || x.order - y.order);
  const winner = usable[0];
  if (winner?.value === undefined) {
    ctx.dropped.push({
      ref: b.ref,
      reason: 'No value or complete curve was stated for this constant.',
    });
    return undefined;
  }
  const winnerValue = winner.value;
  const assumed = proposals.some((p) => p.assumed);
  const prov = provenance(
    ctx,
    b.ref,
    winner.ev,
    assumed,
    typeof winnerValue === 'number' ? winnerValue : undefined,
  );
  const others = usable.filter(
    (o) => o !== winner && describeValue(o.value ?? 0) !== describeValue(winnerValue),
  );
  if (others.length > 0) {
    prov.alternatives = others.map((o) => {
      const e = o.ev[0];
      return {
        source: e?.source ?? 'gamex:unverified',
        location: e?.location ?? '',
        excerpt: e?.excerpt ?? '',
        value: typeof o.value === 'number' ? o.value : describeValue(o.value ?? 0),
      };
    });
    ctx.conflicts.push({
      ref: b.ref,
      chosen: { source: prov.source, location: prov.location, value: describeValue(winnerValue) },
      others: others.map((o) => ({
        source: o.ev[0]?.source ?? 'gamex:unverified',
        location: o.ev[0]?.location ?? '',
        value: describeValue(o.value ?? 0),
      })),
    });
  }
  const p = winner.p;
  return {
    id: b.id,
    name: b.name,
    ...(b.description === undefined ? {} : { description: b.description }),
    unit: p.unit.trim() === '' ? 'count' : p.unit,
    value: winnerValue,
    ...(p.min === null ? {} : { min: p.min }),
    ...(p.max === null ? {} : { max: p.max }),
    ...(p.integer ? { integer: true } : {}),
    balanceFile: toId(p.balanceFile.trim() === '' ? 'balance' : p.balanceFile),
    provenance: prov,
  };
}

function variableFrom(ctx: Ctx, proposals: readonly VariableProposal[]): Variable | undefined {
  const p = proposals[0];
  if (p === undefined) return undefined;
  const b = base(ctx, 'var', p);
  const ev = verified(
    ctx,
    b.ref,
    proposals.flatMap((x) => x.evidence),
  );
  return {
    id: b.id,
    name: b.name,
    ...(b.description === undefined ? {} : { description: b.description }),
    scope: p.scope,
    type: p.type,
    initial: p.initial,
    ...(p.enumValues === null ? {} : { enumValues: p.enumValues }),
    ...(p.min === null ? {} : { min: p.min }),
    ...(p.max === null ? {} : { max: p.max }),
    provenance: provenance(
      ctx,
      b.ref,
      ev,
      proposals.some((x) => x.assumed),
    ),
  };
}

type Built<T> = T & { provenance: Provenance };

function build<
  P extends {
    id: string;
    name: string;
    description: string | null;
    assumed: boolean;
    evidence: Evidence[];
  },
  N,
>(
  ctx: Ctx,
  prefix: string,
  groups: readonly P[][],
  make: (p: P, b: { id: string; name: string; description?: string }) => N,
): Built<N>[] {
  const out: Built<N>[] = [];
  for (const g of groups) {
    const p = g[0];
    if (p === undefined) continue;
    const b = base(ctx, prefix, p);
    const ev = verified(
      ctx,
      b.ref,
      g.flatMap((x) => x.evidence),
    );
    const named = {
      id: b.id,
      name: b.name,
      ...(b.description === undefined ? {} : { description: b.description }),
    };
    out.push({
      ...make(p, named),
      provenance: provenance(
        ctx,
        b.ref,
        ev,
        g.some((x) => x.assumed),
      ),
    });
  }
  return out;
}

/**
 * Turns the passes' proposals into one candidate Game Model, deterministically: normalizes ids and
 * references, merges proposals with the same id (config/code values beat design-document values; the
 * others are kept as `alternatives`), verifies every quote against the source text, adds default
 * personas, KPIs and economy flows, repairs what is invalid by removal, and raises gaps for
 * everything that needs a decision.
 */
export function assembleCandidate(outputs: PassOutputs, chunkList: readonly Chunk[]): Candidate {
  const chunks = new Map(chunkList.map((c) => [c.id, c]));
  const byPath = new Map<string, Chunk[]>();
  for (const c of chunkList) byPath.set(c.path, [...(byPath.get(c.path) ?? []), c]);
  const ctx: Ctx = {
    chunks,
    byPath,
    aliases: new Map(),
    unverified: [],
    valueMismatches: [],
    noEvidence: [],
    dropped: [],
    conflicts: [],
    merged: 0,
  };

  const inv = outputs.inventory;
  const flow = outputs.flow;
  const mon = outputs.monetization;
  const allConstants = [
    ...inv.flatMap((o) => o.constants),
    ...flow.flatMap((o) => o.constants),
    ...mon.flatMap((o) => o.constants),
  ];
  const allVariables = [
    ...inv.flatMap((o) => o.variables),
    ...flow.flatMap((o) => o.variables),
    ...mon.flatMap((o) => o.variables),
  ];

  const metaIn = inv[0]?.meta;
  const unique = (xs: readonly string[]): string[] => [
    ...new Set(xs.map((x) => x.trim()).filter((x) => x !== '')),
  ];
  const meta: GameModel['meta'] = {
    name: metaIn?.name.trim() === '' || metaIn === undefined ? 'Untitled game' : metaIn.name.trim(),
    genre: metaIn?.genre ?? '',
    platforms: unique(inv.flatMap((o) => o.meta.platforms.map((p) => p.toLowerCase()))),
    targetMarkets: unique(inv.flatMap((o) => o.meta.targetMarkets)),
    schemaVersion: SCHEMA_VERSION,
    modelVersion: 0,
  };

  const entities = build(
    ctx,
    'ent',
    group(
      ctx,
      inv.flatMap((o) => o.entities),
    ),
    (p, b): Omit<Entity, 'provenance'> => ({
      ...b,
      kind: p.kind,
      attributes: Object.fromEntries(
        p.attributes.map((a) => [idToKey(toId(a.name)), ref(a.ref, ['const', 'var'])]),
      ),
    }),
  );
  const resources = build(
    ctx,
    'res',
    group(
      ctx,
      inv.flatMap((o) => o.resources),
    ),
    (p, b): Omit<Resource, 'provenance'> => ({
      ...b,
      kind: p.kind,
      starting: Math.max(0, Math.round(p.starting ?? 0)),
      ...(p.cap === null ? {} : { cap: Math.max(0, Math.round(p.cap)) }),
      ...(p.unit === null ? {} : { unit: p.unit }),
    }),
  );
  const constants = group(ctx, allConstants).flatMap((g) => constantFrom(ctx, g) ?? []);
  const variables = group(ctx, allVariables).flatMap((g) => variableFrom(ctx, g) ?? []);

  const states = build(
    ctx,
    'state',
    group(
      ctx,
      flow.flatMap((o) => o.states),
    ),
    (p, b): Omit<State, 'provenance'> => ({
      ...b,
      kind: p.kind,
      ...(p.code === null || p.code.trim() === '' ? {} : { code: p.code.trim() }),
      ...(p.durationSeconds === null ? {} : { duration: p.durationSeconds }),
    }),
  );
  const actions = build(
    ctx,
    'action',
    group(
      ctx,
      flow.flatMap((o) => o.actions),
    ),
    (p, b): Omit<Action, 'provenance'> => ({
      ...b,
      actor: p.actor,
      preconditions: p.preconditions,
      costs: p.costs.map((c) => ({ resource: ref(c.resource, ['res']), amount: c.amount })),
      effects: p.effects.map(effect),
      ...(p.limits.length === 0 ? {} : { limits: p.limits.map(limit) }),
      ...(p.cooldownSeconds === null ? {} : { cooldown: { seconds: p.cooldownSeconds } }),
      ...(p.outcomes.length === 0
        ? {}
        : {
            outcomes: p.outcomes.map((o) => ({
              id: toId(o.id),
              weight: o.weight,
              effects: o.effects.map(effect),
            })),
          }),
      ...(p.durationSeconds === null ? {} : { duration: p.durationSeconds }),
      errorCode: code(p.errorCode, `${code(b.id, 'ACTION')}_NOT_ALLOWED`),
    }),
  );
  const transitionGroups = groupBySignature(
    ctx,
    flow.flatMap((o) => o.transitions),
    (t) =>
      [
        ref(t.from, ['state']),
        t.to === 'return' ? 'return' : ref(t.to, ['state']),
        t.trigger,
        t.outcome ?? '',
      ].join('|'),
  );
  const transitions = build(
    ctx,
    'transition',
    transitionGroups,
    (p, b): Omit<Transition, 'provenance'> => ({
      ...b,
      from: ref(p.from, ['state']),
      to: p.to.trim() === 'return' ? 'return' : ref(p.to, ['state']),
      trigger: p.trigger === 'ui' || p.trigger === 'auto' ? p.trigger : ref(p.trigger, ['action']),
      ...(p.outcome === null ? {} : { outcome: toId(p.outcome) }),
      ...(p.guard === null || p.guard.trim() === '' ? {} : { guard: p.guard }),
      ...(p.effects.length === 0 ? {} : { effects: p.effects.map(effect) }),
      ...(p.beginsMission ? { beginsMission: true } : {}),
      ...(p.endsMission ? { endsMission: true } : {}),
    }),
  );

  const placementGroups = groupBySignature(
    ctx,
    mon.flatMap((o) => o.placements),
    (p) => `${p.format}|${ref(p.trigger, ['action', 'state'])}`,
  );
  const placements = build(
    ctx,
    'placement',
    placementGroups,
    (p, b): Omit<Placement, 'provenance'> => {
      const trigger = ref(p.trigger, ['action', 'state']);
      return {
        ...b,
        format: p.format,
        trigger: trigger.startsWith('action:') ? { action: trigger } : { state: trigger },
        eligibility: p.eligibility,
        ...(p.caps.length === 0 ? {} : { caps: p.caps.map(limit) }),
        ...(p.cooldownSeconds === null ? {} : { cooldownSeconds: p.cooldownSeconds }),
        ...(p.reward.length === 0 ? {} : { reward: p.reward.map(effect) }),
        ...(p.onShow.length === 0 ? {} : { onShow: p.onShow.map(effect) }),
        ...(p.inWorld ? { inWorld: true } : {}),
      };
    },
  );
  const rules = build(
    ctx,
    'rule',
    group(
      ctx,
      mon.flatMap((o) => o.rules),
    ),
    (p, b): Omit<Rule, 'provenance'> => {
      const targets = p.appliesTo.map((t) => ref(t, ['action', 'placement']));
      const acts = targets.filter((t) => !t.startsWith('placement:'));
      const pls = targets.filter((t) => t.startsWith('placement:'));
      return {
        ...b,
        appliesTo: {
          ...(acts.length === 0 ? {} : { actions: acts }),
          ...(pls.length === 0 ? {} : { placements: pls }),
        },
        expr: p.expr,
        severity: p.severity,
        errorCode: code(p.errorCode, `${code(b.id, 'RULE')}_VIOLATED`),
      };
    },
  );
  const invariants = build(
    ctx,
    'inv',
    group(
      ctx,
      mon.flatMap((o) => o.invariants),
    ),
    (p, b): Omit<Invariant, 'provenance'> => {
      const target = p.at === null ? undefined : ref(p.at, ['placement', 'action', 'state']);
      const at =
        target === undefined
          ? undefined
          : target.startsWith('placement:')
            ? { placement: target }
            : target.startsWith('action:')
              ? { action: target }
              : { state: target };
      return {
        ...b,
        kind: 'trace',
        ...(at === undefined ? {} : { at }),
        expr: p.expr,
        severity: p.severity,
      };
    },
  );
  const gaps = build(
    ctx,
    'gap',
    group(
      ctx,
      outputs.gaps.flatMap((o) => o.gaps),
    ),
    (p, b): Omit<Gap, 'provenance'> => ({
      ...b,
      kind: p.kind,
      question: p.question.trim() === '' ? p.name : p.question,
      related: [...new Set(p.related.map((r) => ref(r, ALL_PREFIXES)))],
      blocking: p.blocking,
    }),
  );
  // Gaps restate open questions; they are never themselves "assumed".
  for (const g of gaps) if (g.provenance.status === 'assumed') g.provenance.status = 'detected';

  const stateIds = new Set(states.map((s) => s.id));
  const initialRaw = flow
    .map((o) => ref(o.initialState, ['state']))
    .find((r) => stateIds.has(r.slice('state:'.length)));
  const firstState = states[0];
  const initial =
    initialRaw ?? (firstState === undefined ? 'state:missing' : `state:${firstState.id}`);

  let model: GameModel = {
    meta,
    entities,
    resources,
    constants,
    variables,
    actions,
    rules,
    stateMachine: { initial, states, transitions },
    flows: [],
    monetization: {
      placements,
      forbiddenStates: [
        ...new Set(mon.flatMap((o) => o.forbiddenStates.map((s) => ref(s, ['state'])))),
      ],
    },
    personas: defaultPersonas(),
    kpis: [],
    invariants,
    gaps,
  };
  const first = repairModel(model);
  ctx.dropped.push(...first.dropped);
  model = first.model;
  model.flows = defaultFlows(model);
  model.kpis = defaultKpis(model);
  model.gaps.push(
    ...derivedGaps(model, {
      conflicts: ctx.conflicts,
      dropped: ctx.dropped,
      unverified: [
        ...new Set([...ctx.unverified.map((u) => u.ref), ...ctx.valueMismatches.map((v) => v.ref)]),
      ],
      defaultPersonas: true,
    }),
  );
  const second = repairModel(model);
  ctx.dropped.push(...second.dropped);
  model = second.model;

  const counts: Record<string, number> = {
    entities: model.entities.length,
    resources: model.resources.length,
    constants: model.constants.length,
    variables: model.variables.length,
    actions: model.actions.length,
    rules: model.rules.length,
    states: model.stateMachine.states.length,
    transitions: model.stateMachine.transitions.length,
    placements: model.monetization.placements.length,
    invariants: model.invariants.length,
    gaps: model.gaps.length,
  };
  return {
    model,
    report: {
      aliases: [...ctx.aliases].map(([from, to]) => ({ from, to })),
      conflicts: ctx.conflicts,
      unverified: ctx.unverified,
      valueMismatches: ctx.valueMismatches,
      noEvidence: [...new Set(ctx.noEvidence)],
      dropped: ctx.dropped,
      merged: ctx.merged,
      counts,
    },
    issues: second.issues,
  };
}
