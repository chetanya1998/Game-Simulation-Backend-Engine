import type { Constant, GameModel } from '@gamex/model';

export type Params = Record<string, number>;

export interface SliderSpec {
  key: string;
  id: string;
  name: string;
  unit: string;
  group: string;
  value: number;
  min: number;
  max: number;
  step: number;
  assumed: boolean;
}

function keyOf(c: Constant): string {
  return c.key ?? c.id.replace(/-([a-z0-9])/g, (_, x: string) => x.toUpperCase());
}

/** One slider per scalar constant; the declared min/max/step, or a range around the value. */
export function sliders(model: GameModel): SliderSpec[] {
  return model.constants.flatMap((c) => {
    if (typeof c.value !== 'number') return [];
    const v = c.value;
    const span = Math.abs(v) > 0 ? Math.abs(v) : 1;
    const min = c.min ?? (v >= 0 ? 0 : v - span);
    const max = c.max ?? (v === 0 ? 1 : v + span * 2);
    const step =
      c.step ?? (c.integer === true || Number.isInteger(v) ? 1 : Math.max(0.01, (max - min) / 100));
    return [
      {
        key: keyOf(c),
        id: c.id,
        name: c.name ?? c.id,
        unit: c.unit,
        group: c.balanceFile,
        value: v,
        min,
        max,
        step,
        assumed: c.provenance.status === 'assumed',
      },
    ];
  });
}

/** Only real changes: overrides equal to the model value are dropped, so a reset variant has no params. */
export function cleanParams(model: GameModel, params: Params): Params {
  const values = new Map(sliders(model).map((s) => [s.key, s.value]));
  return Object.fromEntries(
    Object.entries(params)
      .filter(([k, v]) => values.has(k) && values.get(k) !== v)
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );
}

/** The model with a variant's overrides written into its constants (for saving or exporting). */
export function applyParams(model: GameModel, params: Params): GameModel {
  const out = structuredClone(model);
  for (const c of out.constants) {
    const v = params[keyOf(c)];
    if (v !== undefined && typeof c.value === 'number' && v !== c.value) {
      c.value = v;
      c.provenance = { ...c.provenance, status: 'edited' };
    }
  }
  return out;
}
