import { walkExpr, type Expr } from '../expr/ast.js';
import { parseExpr } from '../expr/parser.js';
import { typecheckExpr, type TypeEnv } from '../expr/typecheck.js';
import type { ExprType } from '../expr/types.js';
import type { Effect, GameModel } from '../schema/game-model.js';
import type { IssueCollector, Path } from './collector.js';
import type { ModelEnvs } from './env.js';

export interface ExprSite {
  readonly path: Path;
  readonly source: string;
  /** Expected type; for effects it comes from the target. */
  readonly expected: ExprType | { readonly target: string };
  readonly env: 'model' | 'aggregate';
  readonly nodeRef: string;
}

/** Every expression in the model, with what it must evaluate to. */
export function collectExpressions(model: GameModel): ExprSite[] {
  const out: ExprSite[] = [];
  const site = (
    path: Path,
    source: string,
    expected: ExprSite['expected'],
    nodeRef: string,
    env: ExprSite['env'] = 'model',
  ): void => {
    out.push({ path, source, expected, env, nodeRef });
  };
  const effects = (list: readonly Effect[] | undefined, base: Path, nodeRef: string): void => {
    list?.forEach((e, i) => {
      site([...base, i, 'value'], e.value, { target: e.target }, nodeRef);
    });
  };

  model.actions.forEach((a, i) => {
    const ref = `action:${a.id}`;
    a.preconditions.forEach((p, j) => {
      site(['actions', i, 'preconditions', j], p, 'bool', ref);
    });
    a.costs.forEach((c, j) => {
      site(['actions', i, 'costs', j, 'amount'], c.amount, 'number', ref);
    });
    effects(a.effects, ['actions', i, 'effects'], ref);
    if (a.cooldown !== undefined)
      site(['actions', i, 'cooldown', 'seconds'], a.cooldown.seconds, 'number', ref);
    a.limits?.forEach((l, j) => {
      site(['actions', i, 'limits', j, 'max'], l.max, 'number', ref);
    });
    a.outcomes?.forEach((o, j) => {
      site(['actions', i, 'outcomes', j, 'weight'], o.weight, 'number', ref);
      effects(o.effects, ['actions', i, 'outcomes', j, 'effects'], ref);
    });
    if (a.duration !== undefined) site(['actions', i, 'duration'], a.duration, 'number', ref);
  });
  model.rules.forEach((r, i) => {
    site(['rules', i, 'expr'], r.expr, 'bool', `rule:${r.id}`);
  });
  model.stateMachine.states.forEach((s, i) => {
    if (s.duration !== undefined)
      site(['stateMachine', 'states', i, 'duration'], s.duration, 'number', `state:${s.id}`);
  });
  model.stateMachine.transitions.forEach((t, i) => {
    const ref = `transition:${t.id}`;
    if (t.guard !== undefined)
      site(['stateMachine', 'transitions', i, 'guard'], t.guard, 'bool', ref);
    effects(t.effects, ['stateMachine', 'transitions', i, 'effects'], ref);
  });
  model.monetization.placements.forEach((p, i) => {
    const ref = `placement:${p.id}`;
    const base = ['monetization', 'placements', i];
    p.eligibility.forEach((e, j) => {
      site([...base, 'eligibility', j], e, 'bool', ref);
    });
    p.caps?.forEach((c, j) => {
      site([...base, 'caps', j, 'max'], c.max, 'number', ref);
    });
    if (p.cooldownSeconds !== undefined)
      site([...base, 'cooldownSeconds'], p.cooldownSeconds, 'number', ref);
    effects(p.reward, [...base, 'reward'], ref);
    effects(p.onShow, [...base, 'onShow'], ref);
  });
  model.kpis.forEach((k, i) => {
    if (k.expr !== undefined) site(['kpis', i, 'expr'], k.expr, 'number', `kpi:${k.id}`);
  });
  model.invariants.forEach((inv, i) => {
    site(
      ['invariants', i, 'expr'],
      inv.expr,
      'bool',
      `inv:${inv.id}`,
      inv.kind === 'aggregate' ? 'aggregate' : 'model',
    );
  });
  return out;
}

export interface ExpressionUsage {
  /** Identifiers used anywhere (value positions and curve names). */
  readonly identifiers: ReadonlySet<string>;
  /** Parsed ASTs by JSON pointer, for later layers. */
  readonly asts: ReadonlyMap<string, Expr>;
}

/** Layer 4: every expression parses and type-checks against the model. */
export function checkExpressions(
  model: GameModel,
  envs: ModelEnvs,
  issues: IssueCollector,
): ExpressionUsage {
  const identifiers = new Set<string>();
  const asts = new Map<string, Expr>();
  for (const s of collectExpressions(model)) {
    const report = (
      code: string,
      message: string,
      offset: number,
      hint: string | undefined,
    ): void => {
      issues.error(
        code,
        s.path,
        `${message} — in "${s.source}" at character ${String(offset + 1)}`,
        { hint, nodeRef: s.nodeRef, column: offset },
      );
    };
    const parsed = parseExpr(s.source);
    if (!parsed.ok) {
      report(parsed.error.code, parsed.error.message, parsed.error.span.start, parsed.error.hint);
      continue;
    }
    asts.set(s.path.join('/'), parsed.value);
    walkExpr(parsed.value, (n) => {
      if (n.kind === 'ident') identifiers.add(n.name);
    });

    let expected: ExprType | undefined;
    if (typeof s.expected === 'string') expected = s.expected;
    else expected = envs.targets.get(s.expected.target)?.type; // unknown targets are reported by layer 3
    const env: TypeEnv = s.env === 'aggregate' ? envs.aggregate : envs.model;
    const result = typecheckExpr(parsed.value, env, expected);
    for (const e of result.errors) report(e.code, e.message, e.span.start, e.hint);

    // Assigning a string literal to an enum variable: the literal must be one of its values.
    if (typeof s.expected !== 'string' && parsed.value.kind === 'string') {
      const values = envs.targets.get(s.expected.target)?.enumValues;
      if (values !== undefined && !values.includes(parsed.value.value)) {
        report(
          'EXPR_UNKNOWN_ENUM_VALUE',
          `"${parsed.value.value}" is not a possible value of ${s.expected.target}`,
          0,
          `Possible values: ${values.map((v) => `"${v}"`).join(', ')}.`,
        );
      }
    }
  }
  return { identifiers, asts };
}
