import { evalCurve, idToKey, normalizeGameModel, type Curve, type GameModel } from '@gamex/model';
import { GENERATED_HEADER, MD_HEADER, code, mdTable, type FileMap } from './common.js';

function describeCurve(c: Curve): string {
  const round =
    c.rounding === undefined || c.rounding === 'none' ? '' : `, rounded (${c.rounding})`;
  const clamp =
    c.min === undefined && c.max === undefined
      ? ''
      : `, clamped to ${String(c.min ?? '−∞')}…${String(c.max ?? '∞')}`;
  switch (c.type) {
    case 'linear':
      return `linear: ${String(c.params.base)} + ${String(c.params.perStep)} × (n − ${String(c.params.from ?? 1)})${round}${clamp}`;
    case 'geometric':
      return `geometric: ${String(c.params.base)} × ${String(c.params.ratio)}^(n − ${String(c.params.from ?? 1)})${round}${clamp}`;
    case 'table':
      return `table from n = ${String(c.params.from ?? 1)}: [${c.params.values.join(', ')}] (n is clamped to the table)${round}${clamp}`;
    case 'piecewise':
      return `piecewise: ${c.params.segments.map((s) => `${s.upTo === undefined ? 'otherwise' : `n ≤ ${String(s.upTo)}`} → ${describeCurve(s.curve)}`).join('; ')}${round}${clamp}`;
  }
}

/** gamex/formulas/FORMULAS.md and the reference implementation gamex/formulas/reference.ts. */
export function renderFormulas(model: GameModel, files: FileMap): void {
  const n = normalizeGameModel(model);
  const curves = n.constants.filter((k) => typeof k.value !== 'number');
  const scalars = n.constants.filter((k) => typeof k.value === 'number');
  const curveSections = curves.map((k) => {
    const curve = k.value as Curve;
    const tiers = Array.from(
      { length: 10 },
      (_, i) => i + (('from' in curve.params ? curve.params.from : undefined) ?? 1),
    );
    const values = tiers.map((t) => {
      const r = evalCurve(curve, t);
      return r.ok ? String(r.value) : 'error';
    });
    return `### ${code(idToKey(k.id))} — ${k.name ?? k.id} (${k.unit})\n\n${describeCurve(curve)}\n\n${mdTable(['n', ...tiers.map(String)], [['value', ...values]])}`;
  });
  const actionRows = n.actions.flatMap((a) => [
    ...a.preconditions.map((p) => [a.id, 'precondition', code(p)]),
    ...a.costs.map((c) => [a.id, `cost (${c.resource})`, code(c.amount)]),
    ...a.effects.map((e) => [a.id, `effect ${e.op} ${e.target}`, code(e.value)]),
    ...(a.outcomes ?? []).flatMap((o) => [
      [a.id, `outcome "${o.id}" weight`, code(o.weight)],
      ...o.effects.map((e) => [a.id, `outcome "${o.id}": ${e.op} ${e.target}`, code(e.value)]),
    ]),
  ]);
  const ruleRows = n.rules.map((r) => [
    r.id,
    code(r.expr),
    r.errorCode,
    r.derivedFrom === undefined ? 'designer rule' : `generated from ${r.derivedFrom}`,
  ]);
  const placementRows = n.monetization.placements.flatMap((p) =>
    p.eligibility.map((e) => [p.id, code(e)]),
  );

  files.set('gamex/formulas/FORMULAS.md', {
    ownership: 'generated',
    content: `${MD_HEADER}

# Formulas — ${model.meta.name}

Every formula in the Game Model, in one place. Values come from \`../balance/*.json\`; the executable
definition is [\`reference.ts\`](./reference.ts) (zero dependencies, runs with plain \`node\`).

Rules of the formula language: numbers, \`true\`/\`false\`, \`"text"\`; \`+ - * / %\`, comparisons, \`&& || !\`,
\`a ? b : c\`; functions \`min max clamp abs floor ceil round\` (\`round\` rounds halves to even), \`curve(name, n)\`,
\`eligible("placement-id")\`. Division by zero is an error. All effects of one step are computed from the state
before the step.

## Curves

${curveSections.length === 0 ? '_No curves._' : curveSections.join('\n\n')}

## Scalar constants

${mdTable(
  ['Key', 'Value', 'Unit', 'Range', 'Status'],
  scalars.map((k) => [
    code(idToKey(k.id)),
    String(k.value as number),
    k.unit,
    k.min === undefined && k.max === undefined
      ? ''
      : `${String(k.min ?? '')}…${String(k.max ?? '')}`,
    k.provenance.status,
  ]),
)}

## Actions

${mdTable(['Action', 'Part', 'Formula'], actionRows)}

## Rules

${mdTable(['Rule', 'Must be true', 'Error code', 'Origin'], ruleRows)}

## Ad and IAP eligibility

${placementRows.length === 0 ? '_None._' : mdTable(['Placement', 'Condition'], placementRows)}
`,
  });

  const curveFns = curves.map((k) => {
    const key = idToKey(k.id);
    return `/** ${k.name ?? k.id} (${k.unit}): ${describeCurve(k.value as Curve)}. */\nexport function ${key}(n: number): number {\n  return evalCurve(curves[${JSON.stringify(key)}] as Curve, n);\n}`;
  });
  const formulaEntries = [
    ...n.actions.flatMap((a) => [
      ...a.costs.map((c, i) => [`${a.id}#cost-${String(i)}`, c.amount]),
      ...a.effects.map((e, i) => [`${a.id}#effect-${String(i)}`, e.value]),
      ...(a.outcomes ?? []).map((o) => [`${a.id}#weight-${o.id}`, o.weight]),
    ]),
    ...n.rules.map((r) => [`rule:${r.id}`, r.expr]),
  ];
  const constantsObj = Object.fromEntries(scalars.map((k) => [idToKey(k.id), k.value as number]));
  const curvesObj = Object.fromEntries(curves.map((k) => [idToKey(k.id), k.value]));
  files.set('gamex/formulas/reference.ts', {
    ownership: 'generated',
    content: `// ${GENERATED_HEADER}
//
// Reference implementation of every formula of ${model.meta.name}. Zero dependencies; import it from tests or
// run it with plain \`node\` (≥ 22.18). Game and backend code should read values from ../balance/*.json.
import { evalCurve, evaluate, parse, type Curve, type Value } from '../tests/runner/interpreter.ts';

/** Scalar constants (same values as ../balance/*.json). */
export const constants = ${JSON.stringify(constantsObj, null, 2)} as const;

const curves: Record<string, Curve> = ${JSON.stringify(curvesObj, null, 2)};

${curveFns.join('\n\n')}

/** Every formula of the model by place (action costs/effects/outcome weights, rules). */
export const formulas: Readonly<Record<string, string>> = ${JSON.stringify(Object.fromEntries(formulaEntries), null, 2)};

/** Evaluates a formula with the given variable/resource values (constants and curves are filled in). */
export function evaluateFormula(source: string, values: Record<string, Value>, now = 0): Value {
  const builtins: Record<string, Value> = { now, 'persona.skill': 0.5, 'persona.churnSensitivity': 0.5 };
  return evaluate(parse(source), {
    value: (name) => values[name] ?? (constants as Record<string, number>)[name] ?? builtins[name],
    curve: (name, n) => evalCurve(curves[name] as Curve, n),
    eligible: () => {
      throw new Error('eligible() needs the full interpreter (tests/runner/interpreter.ts)');
    },
  });
}
`,
  });
}
