/**
 * What the LLM is asked to return, per extraction pass. These are deliberately *not* the Game Model
 * schema: they are flat, every field is required (nullable instead of optional), there are no records
 * (arrays of `{name, ref}` instead) and no recursion, so they work as structured-output schemas and are
 * easy for any agent to fill in. Deterministic code (`assemble.ts`) turns them into model nodes.
 */
import { z } from 'zod';

export const EvidenceSchema = z.strictObject({
  chunk: z
    .string()
    .describe('The chunk id exactly as given in the documents, e.g. "docs/GDD.md#L129-172".'),
  quote: z
    .string()
    .describe(
      'Text copied verbatim from that chunk — one line or a short sentence, at most 200 characters.',
    ),
});

const node = {
  id: z.string().describe('kebab-case id, e.g. "max-revives-per-mission". Stable and descriptive.'),
  name: z.string().describe('Human-readable name.'),
  description: z.string().nullable(),
  assumed: z
    .boolean()
    .describe(
      'true when the source marks the item as a placeholder/assumption (e.g. "[ASSUMED]", "TBD"), or the item is needed but not stated.',
    ),
  evidence: z
    .array(EvidenceSchema)
    .describe('Where the item is stated. At least one entry unless assumed.'),
};

const expr = (what: string) =>
  z.string().describe(`Expression (${what}) over camelCase keys of ids.`);

export const EffectProposalSchema = z.strictObject({
  op: z.enum(['set', 'add', 'sub']),
  target: z.string().describe('"var:<id>" or "res:<id>".'),
  value: expr('number, boolean or quoted string'),
});

export const LimitProposalSchema = z.strictObject({
  max: expr('number'),
  per: z.enum(['mission', 'session', 'day', 'lifetime']),
  errorCode: z.string().nullable().describe('UPPER_SNAKE_CASE; null for the default.'),
});

export const CurveProposalSchema = z.strictObject({
  type: z.enum(['linear', 'geometric', 'table']),
  base: z.number().nullable().describe('linear/geometric: value at the first tier.'),
  perStep: z.number().nullable().describe('linear: added per tier.'),
  ratio: z.number().nullable().describe('geometric: multiplied per tier.'),
  values: z.array(z.number()).nullable().describe('table: one value per tier.'),
  from: z.number().nullable().describe('First tier (default 1).'),
  rounding: z.enum(['none', 'floor', 'ceil', 'round-half-even']).nullable(),
});

export const ConstantProposalSchema = z.strictObject({
  ...node,
  unit: z.string().describe('e.g. "coins", "seconds", "count", "multiplier", "usd".'),
  value: z
    .number()
    .nullable()
    .describe('The number stated in the source; null when it is a curve or not stated.'),
  curve: CurveProposalSchema.nullable().describe('When the value depends on a tier or level.'),
  min: z.number().nullable(),
  max: z.number().nullable(),
  integer: z.boolean(),
  balanceFile: z
    .string()
    .describe('kebab-case group, e.g. "economy", "ads", "combat", "progression".'),
});

export const VariableProposalSchema = z.strictObject({
  ...node,
  scope: z.enum(['player', 'session', 'mission', 'day', 'global']),
  type: z.enum(['int', 'number', 'bool', 'enum', 'timestamp']),
  initial: z.union([z.number(), z.string(), z.boolean()]),
  enumValues: z.array(z.string()).nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
});

export const InventorySchema = z.strictObject({
  meta: z.strictObject({
    name: z.string(),
    genre: z.string(),
    platforms: z.array(z.string()).describe('Lowercase, e.g. ["ios", "android"].'),
    targetMarkets: z.array(z.string()).describe('e.g. ["US"].'),
  }),
  entities: z.array(
    z.strictObject({
      ...node,
      kind: z.enum(['hero', 'enemy', 'boss', 'npc', 'item', 'building', 'mechanic', 'other']),
      attributes: z
        .array(
          z.strictObject({
            name: z.string(),
            ref: z.string().describe('"const:<id>" or "var:<id>".'),
          }),
        )
        .describe('Stats of the entity pointing at constants or variables.'),
    }),
  ),
  resources: z.array(
    z.strictObject({
      ...node,
      kind: z.enum(['soft', 'hard', 'energy', 'xp', 'item', 'other']),
      starting: z.number().nullable(),
      cap: z.number().nullable(),
      unit: z.string().nullable(),
    }),
  ),
  constants: z.array(ConstantProposalSchema),
  variables: z.array(VariableProposalSchema),
});

export const FlowSchema = z.strictObject({
  constants: z.array(ConstantProposalSchema).describe('Only constants not already known.'),
  variables: z.array(VariableProposalSchema).describe('Only variables not already known.'),
  initialState: z.string().describe('"state:<id>" of the first screen.'),
  states: z.array(
    z.strictObject({
      ...node,
      kind: z.enum(['loading', 'menu', 'meta', 'gameplay', 'result', 'overlay', 'ad', 'exit']),
      code: z.string().nullable().describe('Designer code such as "S07".'),
      durationSeconds: expr('number, simulated seconds spent on the screen').nullable(),
    }),
  ),
  actions: z.array(
    z.strictObject({
      ...node,
      actor: z.enum(['player', 'system', 'ad-sdk', 'store']),
      preconditions: z.array(expr('boolean')),
      costs: z.array(
        z.strictObject({ resource: z.string().describe('"res:<id>".'), amount: expr('number') }),
      ),
      effects: z.array(EffectProposalSchema),
      limits: z.array(LimitProposalSchema),
      cooldownSeconds: expr('number').nullable(),
      outcomes: z
        .array(
          z.strictObject({
            id: z.string(),
            weight: expr('number'),
            effects: z.array(EffectProposalSchema),
          }),
        )
        .describe('Random outcomes (e.g. win/lose of a mission); empty when deterministic.'),
      durationSeconds: expr('number').nullable(),
      errorCode: z.string().describe('UPPER_SNAKE_CASE code returned when a precondition fails.'),
    }),
  ),
  transitions: z.array(
    z.strictObject({
      ...node,
      from: z.string().describe('"state:<id>".'),
      to: z.string().describe('"state:<id>", or "return" to leave an overlay.'),
      trigger: z.string().describe('"ui", "auto", or "action:<id>".'),
      outcome: z
        .string()
        .nullable()
        .describe('Outcome id of the trigger action this transition follows.'),
      guard: expr('boolean').nullable(),
      effects: z.array(EffectProposalSchema),
      beginsMission: z.boolean(),
      endsMission: z.boolean(),
    }),
  ),
});

export const MonetizationProposalSchema = z.strictObject({
  constants: z.array(ConstantProposalSchema).describe('Only constants not already known.'),
  variables: z.array(VariableProposalSchema).describe('Only variables not already known.'),
  placements: z.array(
    z.strictObject({
      ...node,
      format: z.enum(['rewarded', 'interstitial', 'banner', 'mrec', 'iap', 'offerwall']),
      trigger: z
        .string()
        .describe('"action:<id>" (rewarded, IAP) or "state:<id>" (shown on entering a screen).'),
      eligibility: z.array(expr('boolean')),
      caps: z.array(LimitProposalSchema),
      cooldownSeconds: expr('number').nullable(),
      reward: z.array(EffectProposalSchema),
      onShow: z.array(EffectProposalSchema),
      inWorld: z
        .boolean()
        .describe('true for in-world billboards that may appear during gameplay.'),
    }),
  ),
  rules: z.array(
    z.strictObject({
      ...node,
      appliesTo: z
        .array(z.string())
        .describe('"action:<id>" and/or "placement:<id>" the rule guards.'),
      expr: expr('boolean, must hold'),
      severity: z.enum(['blocking', 'warning']),
      errorCode: z.string(),
    }),
  ),
  invariants: z.array(
    z.strictObject({
      ...node,
      at: z
        .string()
        .nullable()
        .describe('"placement:<id>", "action:<id>" or "state:<id>"; null = every step.'),
      expr: expr('boolean, must always hold'),
      severity: z.enum(['blocking', 'warning']),
    }),
  ),
  forbiddenStates: z
    .array(z.string())
    .describe('"state:<id>" of screens where no UI ad may ever appear.'),
});

export const GapsSchema = z.strictObject({
  gaps: z.array(
    z.strictObject({
      ...node,
      kind: z.enum(['missing', 'ambiguous', 'contradiction', 'assumption']),
      question: z.string().describe('The open question, phrased for the designer.'),
      related: z
        .array(z.string())
        .describe('Typed refs of the items concerned, e.g. "placement:<id>".'),
      blocking: z.boolean().describe('true when a decision cannot be made without the answer.'),
    }),
  ),
});

export const PASSES = ['inventory', 'flow', 'monetization', 'gaps'] as const;
export type PassName = (typeof PASSES)[number];

export const PASS_SCHEMAS = {
  inventory: InventorySchema,
  flow: FlowSchema,
  monetization: MonetizationProposalSchema,
  gaps: GapsSchema,
} as const;

export type Evidence = z.infer<typeof EvidenceSchema>;
export type ConstantProposal = z.infer<typeof ConstantProposalSchema>;
export type VariableProposal = z.infer<typeof VariableProposalSchema>;
export type EffectProposal = z.infer<typeof EffectProposalSchema>;
export type LimitProposal = z.infer<typeof LimitProposalSchema>;
export type CurveProposal = z.infer<typeof CurveProposalSchema>;
export type InventoryOutput = z.infer<typeof InventorySchema>;
export type FlowOutput = z.infer<typeof FlowSchema>;
export type MonetizationOutput = z.infer<typeof MonetizationProposalSchema>;
export type GapsOutput = z.infer<typeof GapsSchema>;

export interface PassOutputs {
  inventory: InventoryOutput[];
  flow: FlowOutput[];
  monetization: MonetizationOutput[];
  gaps: GapsOutput[];
}
