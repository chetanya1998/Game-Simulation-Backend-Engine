import { z } from 'zod';
import { CurveSchema } from './curve.js';
import {
  EffectSchema,
  ErrorCodeSchema,
  ExprSchema,
  IdSchema,
  LimitSchema,
  ProbabilitySchema,
  nodeBase,
  refSchema,
} from './common.js';

export const MetaSchema = z.strictObject({
  name: z.string().min(1),
  genre: z.string(),
  platforms: z.array(z.string()),
  targetMarkets: z.array(z.string()),
  schemaVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, { message: 'schemaVersion is a semver string like "0.1.0"' }),
  modelVersion: z.number().int().min(0),
  contentHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const EntitySchema = z.strictObject({
  ...nodeBase,
  kind: z.enum(['hero', 'enemy', 'boss', 'npc', 'item', 'building', 'mechanic', 'other']),
  /** Named attributes pointing at constants or variables, e.g. { "laserDamage": "const:laser-damage" }. */
  attributes: z.record(z.string(), refSchema('constant', 'variable')),
});

export const ResourceSchema = z.strictObject({
  ...nodeBase,
  kind: z.enum(['soft', 'hard', 'energy', 'xp', 'item', 'other']),
  starting: z.number().int().min(0),
  cap: z.number().int().min(0).optional(),
  unit: z.string().optional(),
});

export const ConstantSchema = z.strictObject({
  ...nodeBase,
  unit: z.string(),
  value: z.union([z.number(), CurveSchema]),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
  integer: z.boolean().optional(),
  /** Which gamex/balance/<file>.json this constant is written to. */
  balanceFile: IdSchema,
});

export const VariableSchema = z.strictObject({
  ...nodeBase,
  /** Lifetime of the value: reset at the start of each mission/session/day; player = forever. */
  scope: z.enum(['player', 'session', 'mission', 'day', 'global']),
  type: z.enum(['int', 'number', 'bool', 'enum', 'timestamp']),
  initial: z.union([z.number(), z.boolean(), z.string()]),
  enumValues: z.array(z.string().min(1)).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

export const OutcomeSchema = z.strictObject({
  id: IdSchema,
  weight: ExprSchema,
  effects: z.array(EffectSchema),
});

export const ActionSchema = z.strictObject({
  ...nodeBase,
  actor: z.enum(['player', 'system', 'ad-sdk', 'store']),
  preconditions: z.array(ExprSchema),
  costs: z.array(z.strictObject({ resource: refSchema('resource'), amount: ExprSchema })),
  effects: z.array(EffectSchema),
  cooldown: z
    .strictObject({ seconds: ExprSchema, errorCode: ErrorCodeSchema.optional() })
    .optional(),
  limits: z.array(LimitSchema).optional(),
  /** Level 1 mission model: weighted outcomes, chosen at random by the engine. */
  outcomes: z.array(OutcomeSchema).optional(),
  duration: ExprSchema.optional(),
  /** Returned when a precondition fails. */
  errorCode: ErrorCodeSchema,
});

export const RuleSchema = z.strictObject({
  ...nodeBase,
  /** Checked before the listed actions run / before the listed placements are shown. */
  appliesTo: z.strictObject({
    actions: z.array(refSchema('action')).optional(),
    placements: z.array(refSchema('placement')).optional(),
  }),
  expr: ExprSchema,
  severity: z.enum(['blocking', 'warning']),
  errorCode: ErrorCodeSchema,
});

export const StateSchema = z.strictObject({
  ...nodeBase,
  kind: z.enum(['loading', 'menu', 'meta', 'gameplay', 'result', 'overlay', 'ad', 'exit']),
  /** Designer-facing code such as "S07". */
  code: z.string().optional(),
  /** Simulated seconds spent in the state. */
  duration: ExprSchema.optional(),
});

export const TransitionSchema = z.strictObject({
  ...nodeBase,
  from: refSchema('state'),
  /** "return" leaves an overlay state (e.g. Pause) back to where the player was. */
  to: z.union([refSchema('state'), z.literal('return')]),
  /** "ui": plain navigation chosen by the player; "auto": taken as soon as its guard holds. */
  trigger: z.union([z.literal('ui'), z.literal('auto'), refSchema('action')]),
  /** For an action with outcomes: the outcome id this transition follows. */
  outcome: IdSchema.optional(),
  guard: ExprSchema.optional(),
  effects: z.array(EffectSchema).optional(),
  beginsMission: z.boolean().optional(),
  endsMission: z.boolean().optional(),
});

export const StateMachineSchema = z.strictObject({
  initial: refSchema('state'),
  states: z.array(StateSchema).min(1, { message: 'the state machine needs at least one state' }),
  transitions: z.array(TransitionSchema),
});

export const FlowNodeSchema = z.strictObject({
  ...nodeBase,
  kind: z.enum(['source', 'sink', 'converter', 'gate', 'pool']),
  resource: refSchema('resource'),
  actions: z.array(refSchema('action')),
  to: z.array(refSchema('flow')),
});

export const AD_FORMATS = [
  'rewarded',
  'interstitial',
  'banner',
  'mrec',
  'iap',
  'offerwall',
] as const;
export const AdFormatSchema = z.enum(AD_FORMATS);

export const PlacementSchema = z.strictObject({
  ...nodeBase,
  format: AdFormatSchema,
  trigger: z.union([
    z.strictObject({ action: refSchema('action') }),
    z.strictObject({ state: refSchema('state') }),
  ]),
  eligibility: z.array(ExprSchema),
  caps: z.array(LimitSchema).optional(),
  cooldownSeconds: ExprSchema.optional(),
  /** Granted when a rewarded placement completes. */
  reward: z.array(EffectSchema).optional(),
  /** Applied every time the placement is shown (the normalizer adds counters for caps and cooldowns). */
  onShow: z.array(EffectSchema).optional(),
  forbiddenIn: z.array(refSchema('state')).optional(),
  /** In-world ads (billboards) are part of the scene and may appear during gameplay. */
  inWorld: z.boolean().optional(),
});

export const RevenueAssumptionsSchema = z.strictObject({
  market: z.string().min(1),
  currency: z.string().min(1),
  ecpm: z.partialRecord(AdFormatSchema, refSchema('constant')),
  fillRate: z.partialRecord(AdFormatSchema, refSchema('constant')),
});

export const MonetizationSchema = z.strictObject({
  placements: z.array(PlacementSchema),
  /** States where no UI ad may ever be shown (e.g. live gameplay, loading). */
  forbiddenStates: z.array(refSchema('state')),
  /** Optional: without it, revenue KPIs are skipped. */
  assumptions: RevenueAssumptionsSchema.optional(),
});

export const DistributionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('constant'), value: z.number() }),
  z.strictObject({ type: z.literal('uniform'), min: z.number(), max: z.number() }),
  z.strictObject({
    type: z.literal('normal'),
    mean: z.number(),
    sd: z.number().min(0),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  z.strictObject({
    type: z.literal('lognormal'),
    mu: z.number(),
    sigma: z.number().min(0),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  z.strictObject({ type: z.literal('poisson'), mean: z.number().min(0) }),
  z.strictObject({ type: z.literal('bernoulli'), p: ProbabilitySchema }),
]);

export const PersonaSchema = z.strictObject({
  ...nodeBase,
  /** Fraction of the simulated population; shares of all personas sum to 1. */
  share: ProbabilitySchema,
  sessionsPerDay: DistributionSchema,
  sessionLengthSeconds: DistributionSchema,
  /** 0 (novice) … 1 (expert); exposed to expressions as persona.skill. */
  skill: DistributionSchema,
  adOptIn: z.strictObject({
    default: ProbabilitySchema,
    byPlacement: z.record(refSchema('placement'), ProbabilitySchema).optional(),
  }),
  purchaseProbabilityPerSession: ProbabilitySchema,
  churnSensitivity: ProbabilitySchema,
  /** Relative preference for "ui" transitions, keyed by transition reference. */
  transitionWeights: z.record(refSchema('transition'), z.number().min(0)).optional(),
});

export const KPI_METRICS = [
  'progression-speed',
  'reach-rate',
  'currency-balance',
  'inflation-rate',
  'faucet-sink-ratio',
  'progression-walls',
  'churn-risk',
  'ad-impressions-per-dau',
  'rewarded-opt-in-rate',
  'ad-revenue-per-dau',
  'iap-conversion',
  'arppu',
  'arpdau',
  'custom',
] as const;

export const KpiSchema = z.strictObject({
  ...nodeBase,
  metric: z.enum(KPI_METRICS),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  /** For metric "custom": a number expression evaluated per player at the end of each day. */
  expr: ExprSchema.optional(),
  persona: refSchema('persona').optional(),
});

export const InvariantSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...nodeBase,
    /** Checked on every step of every simulated player, or only at the given point. */
    kind: z.literal('trace'),
    at: z
      .union([
        z.strictObject({ placement: refSchema('placement') }),
        z.strictObject({ action: refSchema('action') }),
        z.strictObject({ state: refSchema('state') }),
      ])
      .optional(),
    expr: ExprSchema,
    severity: z.enum(['blocking', 'warning']),
  }),
  z.strictObject({
    ...nodeBase,
    /** Checked on aggregated results; identifiers are KPI keys and constant keys. */
    kind: z.literal('aggregate'),
    expr: ExprSchema,
    persona: refSchema('persona').optional(),
    severity: z.enum(['blocking', 'warning']),
  }),
]);

export const GapSchema = z.strictObject({
  ...nodeBase,
  kind: z.enum(['missing', 'ambiguous', 'contradiction', 'assumption']),
  question: z.string().min(1),
  related: z.array(
    refSchema(
      'entity',
      'resource',
      'constant',
      'variable',
      'action',
      'rule',
      'state',
      'transition',
      'flow',
      'placement',
      'persona',
      'kpi',
      'invariant',
    ),
  ),
  blocking: z.boolean(),
});

export const GameModelSchema = z.strictObject({
  $schema: z.string().optional(),
  meta: MetaSchema,
  entities: z.array(EntitySchema),
  resources: z.array(ResourceSchema),
  constants: z.array(ConstantSchema),
  variables: z.array(VariableSchema),
  actions: z.array(ActionSchema),
  rules: z.array(RuleSchema),
  stateMachine: StateMachineSchema,
  flows: z.array(FlowNodeSchema),
  monetization: MonetizationSchema,
  personas: z.array(PersonaSchema),
  kpis: z.array(KpiSchema),
  invariants: z.array(InvariantSchema),
  gaps: z.array(GapSchema),
});

export type GameModel = z.infer<typeof GameModelSchema>;
export type Meta = z.infer<typeof MetaSchema>;
export type Entity = z.infer<typeof EntitySchema>;
export type Resource = z.infer<typeof ResourceSchema>;
export type Constant = z.infer<typeof ConstantSchema>;
export type Variable = z.infer<typeof VariableSchema>;
export type Action = z.infer<typeof ActionSchema>;
export type Outcome = z.infer<typeof OutcomeSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type State = z.infer<typeof StateSchema>;
export type Transition = z.infer<typeof TransitionSchema>;
export type StateMachine = z.infer<typeof StateMachineSchema>;
export type FlowNode = z.infer<typeof FlowNodeSchema>;
export type Placement = z.infer<typeof PlacementSchema>;
export type Monetization = z.infer<typeof MonetizationSchema>;
export type Distribution = z.infer<typeof DistributionSchema>;
export type Persona = z.infer<typeof PersonaSchema>;
export type Kpi = z.infer<typeof KpiSchema>;
export type Invariant = z.infer<typeof InvariantSchema>;
export type Gap = z.infer<typeof GapSchema>;
export type Effect = z.infer<typeof EffectSchema>;
export type Limit = z.infer<typeof LimitSchema>;
export type Provenance = GameModel['entities'][number]['provenance'];
