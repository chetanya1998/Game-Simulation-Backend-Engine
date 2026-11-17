import { idToKey, type GameModel } from '@gamex/model';
import { z } from 'zod';
import { jsonFile, type FileMap } from './common.js';
import { balanceFiles } from './model-facts.js';

export const BalanceFileSchema = z.strictObject({
  $comment: z.string(),
  file: z.string(),
  /** Scalar tunables by key. */
  values: z.record(z.string(), z.number()),
  /** Curve tunables by key (see FORMULAS.md for how to evaluate them). */
  curves: z.record(z.string(), z.unknown()),
  meta: z.record(
    z.string(),
    z.strictObject({
      id: z.string(),
      unit: z.string(),
      status: z.string(),
      min: z.number().optional(),
      max: z.number().optional(),
      step: z.number().optional(),
      description: z.string().optional(),
    }),
  ),
});

export function balanceJsonSchema(): Record<string, unknown> {
  return {
    ...(z.toJSONSchema(BalanceFileSchema, { target: 'draft-2020-12' }) as Record<string, unknown>),
    title: 'GameX Engine balance file',
  };
}

/** gamex/balance/<file>.json — every tunable, which game and backend code must read instead of hardcoding. */
export function renderBalance(model: GameModel, files: FileMap): void {
  for (const file of balanceFiles(model)) {
    const constants = model.constants.filter((k) => k.balanceFile === file);
    const values: Record<string, number> = {};
    const curves: Record<string, unknown> = {};
    const meta: Record<string, unknown> = {};
    for (const k of constants) {
      const key = idToKey(k.id);
      if (typeof k.value === 'number') values[key] = k.value;
      else curves[key] = k.value;
      meta[key] = {
        id: k.id,
        unit: k.unit,
        status: k.provenance.status,
        min: k.min,
        max: k.max,
        step: k.step,
        description: k.description,
      };
    }
    files.set(`gamex/balance/${file}.json`, {
      ownership: 'generated',
      content: jsonFile({ file, values, curves, meta }),
    });
  }
}
