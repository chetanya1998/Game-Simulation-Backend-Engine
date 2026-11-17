import { z } from 'zod';

const Value = z.union([z.number(), z.boolean(), z.string()]);

/** One golden case: given a game state, when something happens, then this is the only correct result. */
export const GoldenCaseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+-\d{3}$/),
  /** What the case pins down, e.g. "rule:revive-limit-mission", "action:revive#precondition-0". */
  rule: z.string(),
  description: z.string(),
  given: z.strictObject({
    /** Current screen id. */
    state: z.string(),
    prevState: z.string().optional(),
    /** Simulated time in seconds (default 0). */
    now: z.number().optional(),
    persona: z
      .strictObject({ skill: z.number().optional(), churnSensitivity: z.number().optional() })
      .optional(),
    /** Values (by key) that differ from the model's initial values. */
    vars: z.record(z.string(), Value),
  }),
  when: z.union([
    z.strictObject({ action: z.string(), outcome: z.string().optional() }),
    z.strictObject({ placement: z.string() }),
  ]),
  then: z.union([
    z.strictObject({
      result: z.enum(['ok', 'rejected']),
      error: z.string().optional(),
      outcome: z.string().optional(),
      /** Numbers: change; other values: new value. Keys sorted. */
      deltas: z.record(z.string(), Value),
      impressions: z.array(z.string()).optional(),
    }),
    z.strictObject({ eligible: z.boolean(), reason: z.string().optional() }),
  ]),
});

export const GoldenFileSchema = z.strictObject({
  $comment: z.string(),
  /** The action or placement these cases cover, e.g. "action:revive". */
  subject: z.string(),
  cases: z.array(GoldenCaseSchema),
});

export type GoldenCase = z.infer<typeof GoldenCaseSchema>;
export type GoldenFile = z.infer<typeof GoldenFileSchema>;

export function goldenJsonSchema(): Record<string, unknown> {
  return {
    ...(z.toJSONSchema(GoldenFileSchema, { target: 'draft-2020-12' }) as Record<string, unknown>),
    title: 'GameX Engine golden test file',
  };
}
