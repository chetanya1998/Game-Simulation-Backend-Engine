import { parseExpr, type Expr, type GameModel } from '@gamex/model';
import { idToKey } from '@gamex/model';

/**
 * Abstract interpretation of expressions over the ranges a model declares (constants' min…max, variables'
 * min…max, resource caps). Sound for "never true": if `canBeTrue` is false, no assignment within the
 * declared ranges makes the expression true. Conservative otherwise.
 */
export type Abstract =
  | { readonly kind: 'num'; readonly lo: number; readonly hi: number }
  | { readonly kind: 'bool'; readonly canBeTrue: boolean; readonly canBeFalse: boolean }
  | { readonly kind: 'str'; readonly values: ReadonlySet<string> | null };

const TOP_NUM: Abstract = {
  kind: 'num',
  lo: Number.NEGATIVE_INFINITY,
  hi: Number.POSITIVE_INFINITY,
};
const TOP_BOOL: Abstract = { kind: 'bool', canBeTrue: true, canBeFalse: true };
const TOP_STR: Abstract = { kind: 'str', values: null };

const num = (lo: number, hi: number): Abstract =>
  Number.isNaN(lo) || Number.isNaN(hi) ? TOP_NUM : { kind: 'num', lo, hi };
const bool = (canBeTrue: boolean, canBeFalse: boolean): Abstract => ({
  kind: 'bool',
  canBeTrue,
  canBeFalse,
});

function mul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : a * b;
}

function asNum(a: Abstract): { lo: number; hi: number } {
  return a.kind === 'num' ? a : { lo: Number.NEGATIVE_INFINITY, hi: Number.POSITIVE_INFINITY };
}

function asBool(a: Abstract): { t: boolean; f: boolean } {
  return a.kind === 'bool' ? { t: a.canBeTrue, f: a.canBeFalse } : { t: true, f: true };
}

function join(a: Abstract, b: Abstract): Abstract {
  if (a.kind === 'num' && b.kind === 'num') return num(Math.min(a.lo, b.lo), Math.max(a.hi, b.hi));
  if (a.kind === 'bool' && b.kind === 'bool')
    return bool(a.canBeTrue || b.canBeTrue, a.canBeFalse || b.canBeFalse);
  if (a.kind === 'str' && b.kind === 'str')
    return {
      kind: 'str',
      values: a.values === null || b.values === null ? null : new Set([...a.values, ...b.values]),
    };
  return a.kind === 'num' ? TOP_NUM : a.kind === 'bool' ? TOP_BOOL : TOP_STR;
}

export type AbstractEnv = ReadonlyMap<string, Abstract>;

export function abstractEval(e: Expr, env: AbstractEnv): Abstract {
  switch (e.kind) {
    case 'number':
      return num(e.value, e.value);
    case 'bool':
      return bool(e.value, !e.value);
    case 'string':
      return { kind: 'str', values: new Set([e.value]) };
    case 'ident':
      return env.get(e.name) ?? TOP_NUM;
    case 'unary': {
      const v = abstractEval(e.operand, env);
      if (e.op === '!') {
        const b = asBool(v);
        return bool(b.f, b.t);
      }
      const n = asNum(v);
      return num(-n.hi, -n.lo);
    }
    case 'ternary': {
      const c = asBool(abstractEval(e.cond, env));
      if (!c.t) return abstractEval(e.otherwise, env);
      if (!c.f) return abstractEval(e.then, env);
      return join(abstractEval(e.then, env), abstractEval(e.otherwise, env));
    }
    case 'call': {
      const args = e.args.map((a) => asNum(abstractEval(a, env)));
      switch (e.callee) {
        case 'min':
          return num(Math.min(...args.map((a) => a.lo)), Math.min(...args.map((a) => a.hi)));
        case 'max':
          return num(Math.max(...args.map((a) => a.lo)), Math.max(...args.map((a) => a.hi)));
        case 'clamp': {
          const [x, lo, hi] = args as [
            { lo: number; hi: number },
            { lo: number; hi: number },
            { lo: number; hi: number },
          ];
          return num(
            Math.min(Math.max(x.lo, lo.lo), hi.hi),
            Math.min(Math.max(x.hi, lo.hi), hi.hi),
          );
        }
        case 'abs': {
          const [x] = args as [{ lo: number; hi: number }];
          if (x.lo >= 0) return num(x.lo, x.hi);
          if (x.hi <= 0) return num(-x.hi, -x.lo);
          return num(0, Math.max(-x.lo, x.hi));
        }
        case 'floor':
        case 'ceil':
        case 'round': {
          const [x] = args as [{ lo: number; hi: number }];
          return num(Math.floor(x.lo), Math.ceil(x.hi));
        }
        case 'eligible':
          return TOP_BOOL;
        default:
          return TOP_NUM;
      }
    }
    case 'binary': {
      const l = abstractEval(e.left, env);
      const r = abstractEval(e.right, env);
      switch (e.op) {
        case '&&': {
          const a = asBool(l);
          const b = asBool(r);
          return bool(a.t && b.t, a.f || b.f);
        }
        case '||': {
          const a = asBool(l);
          const b = asBool(r);
          return bool(a.t || b.t, a.f && b.f);
        }
        case '==':
        case '!=': {
          let canEq = true;
          let canNe = true;
          if (l.kind === 'num' && r.kind === 'num') {
            canEq = l.lo <= r.hi && r.lo <= l.hi;
            canNe = !(l.lo === l.hi && r.lo === r.hi && l.lo === r.lo);
          } else if (
            l.kind === 'str' &&
            r.kind === 'str' &&
            l.values !== null &&
            r.values !== null
          ) {
            canEq = [...l.values].some((v) => r.values?.has(v) === true);
            canNe = !(
              l.values.size === 1 &&
              r.values.size === 1 &&
              [...l.values][0] === [...r.values][0]
            );
          } else if (l.kind === 'bool' && r.kind === 'bool') {
            canEq = (l.canBeTrue && r.canBeTrue) || (l.canBeFalse && r.canBeFalse);
            canNe = (l.canBeTrue && r.canBeFalse) || (l.canBeFalse && r.canBeTrue);
          }
          return e.op === '==' ? bool(canEq, canNe) : bool(canNe, canEq);
        }
        case '<':
        case '<=':
        case '>':
        case '>=': {
          const a = asNum(l);
          const b = asNum(r);
          const [x, y] = e.op === '<' || e.op === '<=' ? [a, b] : [b, a];
          const strict = e.op === '<' || e.op === '>';
          // x < y (or ≤): can be true if x.lo < y.hi; can be false if x.hi ≥ y.lo (or >).
          const canTrue = strict ? x.lo < y.hi : x.lo <= y.hi;
          const canFalse = strict ? x.hi >= y.lo : x.hi > y.lo;
          return bool(canTrue, canFalse);
        }
        case '+': {
          const a = asNum(l);
          const b = asNum(r);
          return num(a.lo + b.lo, a.hi + b.hi);
        }
        case '-': {
          const a = asNum(l);
          const b = asNum(r);
          return num(a.lo - b.hi, a.hi - b.lo);
        }
        case '*': {
          const a = asNum(l);
          const b = asNum(r);
          const ps = [mul(a.lo, b.lo), mul(a.lo, b.hi), mul(a.hi, b.lo), mul(a.hi, b.hi)];
          return num(Math.min(...ps), Math.max(...ps));
        }
        case '/': {
          const a = asNum(l);
          const b = asNum(r);
          if (b.lo <= 0 && b.hi >= 0) return TOP_NUM;
          const ps = [a.lo / b.lo, a.lo / b.hi, a.hi / b.lo, a.hi / b.hi];
          return num(Math.min(...ps), Math.max(...ps));
        }
        case '%':
          return TOP_NUM;
      }
    }
  }
  return TOP_NUM;
}

/** Abstract values of every name in a model, for an expression evaluated in `state` (if known). */
export function abstractEnvFor(model: GameModel, state?: string): Map<string, Abstract> {
  const env = new Map<string, Abstract>();
  for (const c of model.constants) {
    if (typeof c.value !== 'number') continue;
    env.set(idToKey(c.id), num(c.min ?? c.value, c.max ?? c.value));
  }
  for (const v of model.variables) {
    const key = idToKey(v.id);
    if (v.type === 'bool') env.set(key, TOP_BOOL);
    else if (v.type === 'enum') env.set(key, { kind: 'str', values: new Set(v.enumValues ?? []) });
    else env.set(key, num(v.min ?? Number.NEGATIVE_INFINITY, v.max ?? Number.POSITIVE_INFINITY));
  }
  for (const r of model.resources)
    env.set(idToKey(r.id), num(0, r.cap ?? Number.POSITIVE_INFINITY));
  const states = new Set(model.stateMachine.states.map((s) => s.id));
  env.set('state', { kind: 'str', values: state === undefined ? states : new Set([state]) });
  env.set('prevState', { kind: 'str', values: states });
  env.set('now', num(0, Number.POSITIVE_INFINITY));
  env.set('persona.skill', num(0, 1));
  env.set('persona.churnSensitivity', num(0, 1));
  return env;
}

/** True when `source` can never evaluate to true within the declared ranges. */
export function neverTrue(source: string, env: AbstractEnv): boolean {
  const parsed = parseExpr(source);
  if (!parsed.ok) return false;
  const v = abstractEval(parsed.value, env);
  return v.kind === 'bool' && !v.canBeTrue;
}
