import { z } from 'zod';
import type { Curve } from '../curves.js';

const common = {
  rounding: z.enum(['none', 'floor', 'ceil', 'round-half-even']).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
};
const from = z.number().int().optional();

export const CurveSchema: z.ZodType<Curve> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('linear'),
      params: z.strictObject({ base: z.number(), perStep: z.number(), from }),
      ...common,
    }),
    z.strictObject({
      type: z.literal('geometric'),
      params: z.strictObject({ base: z.number(), ratio: z.number(), from }),
      ...common,
    }),
    z.strictObject({
      type: z.literal('table'),
      params: z.strictObject({
        values: z.array(z.number()).min(1, { message: 'a table curve needs at least one value' }),
        from,
      }),
      ...common,
    }),
    z.strictObject({
      type: z.literal('piecewise'),
      params: z.strictObject({
        segments: z
          .array(z.strictObject({ upTo: z.number().int().optional(), curve: CurveSchema }))
          .min(1, { message: 'a piecewise curve needs at least one segment' }),
      }),
      ...common,
    }),
  ]),
);
