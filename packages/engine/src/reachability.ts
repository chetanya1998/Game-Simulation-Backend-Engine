import { normalizeGameModel, type GameModel } from '@gamex/model';
import { compileModel, type CompiledModel } from './compile.js';
import { successors } from './graph.js';
import { abstractEnvFor, neverTrue } from './intervals.js';
import { availableOptions, perform, settle, type StepOption } from './step.js';
import { controlKey, createWorld, type WorldState } from './world.js';
import type { EngineEvent } from './step.js';

export interface ReachabilityIssue {
  readonly kind:
    | 'unreachable-state'
    | 'dead-end'
    | 'trap'
    | 'never-true-guard'
    | 'never-true-precondition'
    | 'never-eligible-placement'
    | 'not-reached-concretely';
  readonly severity: 'error' | 'warning';
  readonly ref: string;
  readonly message: string;
  readonly states?: readonly string[];
}

export interface WitnessStep {
  readonly transition?: string;
  readonly action?: string;
  readonly outcome?: string;
  readonly to: string;
}

export interface ReachabilityReport {
  readonly states: number;
  readonly transitions: number;
  readonly issues: readonly ReachabilityIssue[];
  /** Shortest concrete step sequence found from the initial screen to each screen. */
  readonly witnesses: Readonly<Record<string, readonly WitnessStep[]>>;
  readonly explored: {
    readonly nodes: number;
    readonly complete: boolean;
    readonly maxNodes: number;
  };
}

export interface ReachabilityOptions {
  /** Upper bound on concrete states explored when searching witnesses (default 20 000). */
  readonly maxNodes?: number;
  /** Persona traits used to decide which random outcomes are possible (weights > 0). */
  readonly skill?: number;
}

/** Tarjan's strongly connected components. */
function sccs(
  nodes: readonly string[],
  succ: ReadonlyMap<string, ReadonlySet<string>>,
): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const on = new Set<string>();
  const out: string[][] = [];
  const visit = (v: string): void => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    on.add(v);
    for (const w of succ.get(v) ?? []) {
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v) ?? 0, low.get(w) ?? 0));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v) ?? 0, idx.get(w) ?? 0));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      for (;;) {
        const w = stack.pop() as string;
        on.delete(w);
        comp.push(w);
        if (w === v) break;
      }
      out.push(comp.sort());
    }
  };
  for (const n of nodes) if (!idx.has(n)) visit(n);
  return out;
}

function stepLabel(
  option: StepOption,
  outcome: string | undefined,
  to: string,
  transition: string | undefined,
): WitnessStep {
  const base =
    option.kind === 'action'
      ? { action: option.actionId, ...(outcome === undefined ? {} : { outcome }) }
      : {};
  return { ...base, ...(transition === undefined ? {} : { transition }), to };
}

/** Breadth-first search over concrete game states (every option, every possible outcome). */
function findWitnesses(
  c: CompiledModel,
  maxNodes: number,
  skill: number,
): { witnesses: Record<string, WitnessStep[]>; nodes: number; complete: boolean } {
  const initial = createWorld(c, { persona: { skill, churnSensitivity: 0.5 } });
  const witnesses: Record<string, WitnessStep[]> = { [initial.state]: [] };
  // Screens passed through on the way (auto transitions) get a witness too.
  const note = (events: readonly EngineEvent[], path: readonly WitnessStep[]): WitnessStep[] => {
    const p = [...path];
    for (const e of events) {
      if (e.type !== 'transition') continue;
      p.push({ transition: e.transitionId, to: e.to });
      witnesses[e.to] ??= [...p];
    }
    return p;
  };
  const first = settle(c, initial, { checkInvariants: false });
  const startPath = note(first.events, []);
  const start = first.next;
  // States are deduplicated on screen + variables (not resource amounts or time): enough to find a path
  // to every screen without enumerating every coin balance.
  const seen = new Set([controlKey(c, start)]);
  let frontier: { w: WorldState; path: WitnessStep[] }[] = [{ w: start, path: startPath }];
  let nodes = 1;
  while (frontier.length > 0 && nodes < maxNodes && Object.keys(witnesses).length < c.states.size) {
    const next: typeof frontier = [];
    for (const { w, path } of frontier) {
      for (const option of availableOptions(c, w)) {
        const action = option.kind === 'action' ? c.actions.get(option.actionId) : undefined;
        const outcomes: (string | undefined)[] = action?.outcomes?.map((o) => o.id) ?? [undefined];
        for (const outcome of outcomes) {
          let r;
          try {
            r = perform(c, w, option, {
              checkInvariants: false,
              ...(outcome === undefined ? {} : { outcome }),
            });
          } catch {
            continue;
          }
          const settled = settle(c, r.next, { checkInvariants: false });
          const key = controlKey(c, settled.next);
          if (seen.has(key)) continue;
          seen.add(key);
          nodes++;
          const step = stepLabel(option, r.action?.outcome, r.next.state, r.transition?.id);
          const p = note(settled.events, [...path, step]);
          witnesses[r.next.state] ??= [...path, step];
          // Jump time forward between steps so cooldowns never hide a path.
          next.push({ w: { ...settled.next, now: settled.next.now + 1e6 }, path: p });
          if (nodes >= maxNodes) break;
        }
        if (nodes >= maxNodes) break;
      }
      if (nodes >= maxNodes) break;
    }
    frontier = next;
  }
  return { witnesses, nodes, complete: frontier.length === 0 };
}

/**
 * Structural analysis of the screen flow: unreachable screens, dead ends, loops with no way to make
 * progress, conditions that can never be true given the declared ranges, plus concrete witness paths.
 */
export function analyzeReachability(
  input: GameModel | CompiledModel,
  options: ReachabilityOptions = {},
): ReachabilityReport {
  const c = 'transitionsFrom' in input ? input : compileModel(input);
  const model = normalizeGameModel(c.model);
  const issues: ReachabilityIssue[] = [];
  const succ = successors(c);
  const states = [...c.states.keys()];

  const reached = new Set([c.initialState]);
  const queue = [c.initialState];
  for (const q of queue)
    for (const n of succ.get(q) ?? [])
      if (!reached.has(n)) {
        reached.add(n);
        queue.push(n);
      }
  for (const s of states) {
    if (!reached.has(s))
      issues.push({
        kind: 'unreachable-state',
        severity: 'error',
        ref: `state:${s}`,
        message: `Screen ${s} cannot be reached from ${c.initialState}`,
      });
  }
  for (const s of states) {
    const kind = c.states.get(s)?.kind;
    const outgoing = [...(succ.get(s) ?? [])].filter((t) => t !== s);
    if (kind !== 'exit' && outgoing.length === 0)
      issues.push({
        kind: 'dead-end',
        severity: 'error',
        ref: `state:${s}`,
        message: `Screen ${s} has no way out (only self-loops or nothing)`,
      });
  }

  const progress = new Set(
    c.transitions.filter((t) => t.beginsMission || t.endsMission).map((t) => t.from),
  );
  for (const comp of sccs(states, succ)) {
    const set = new Set(comp);
    const leaves = comp.some((s) => [...(succ.get(s) ?? [])].some((t) => !set.has(t)));
    const hasCycle =
      comp.length > 1 || (succ.get(comp[0] as string)?.has(comp[0] as string) ?? false);
    if (leaves || !hasCycle) continue;
    if (comp.some((s) => progress.has(s) || c.states.get(s)?.kind === 'exit')) continue;
    if (
      comp.length === 1 &&
      issues.some((i) => i.kind === 'dead-end' && i.ref === `state:${comp[0] as string}`)
    )
      continue;
    issues.push({
      kind: 'trap',
      severity: 'error',
      ref: `state:${comp[0] as string}`,
      states: comp,
      message: `Screens ${comp.join(', ')} form a loop with no exit and no mission start/end — players get stuck there`,
    });
  }

  for (const t of model.stateMachine.transitions) {
    if (
      t.guard !== undefined &&
      neverTrue(t.guard, abstractEnvFor(model, t.from.slice('state:'.length)))
    ) {
      issues.push({
        kind: 'never-true-guard',
        severity: 'error',
        ref: `transition:${t.id}`,
        message: `Guard "${t.guard}" of ${t.id} can never be true within the declared ranges`,
      });
    }
  }
  const anyState = abstractEnvFor(model);
  for (const a of model.actions) {
    const bad = a.preconditions.find((p) => neverTrue(p, anyState));
    if (bad !== undefined)
      issues.push({
        kind: 'never-true-precondition',
        severity: 'error',
        ref: `action:${a.id}`,
        message: `Precondition "${bad}" of ${a.id} can never be true — the action can never run`,
      });
  }
  for (const p of model.monetization.placements) {
    const env = abstractEnvFor(
      model,
      'state' in p.trigger ? p.trigger.state.slice('state:'.length) : undefined,
    );
    const bad = p.eligibility.find((e) => neverTrue(e, env));
    if (bad !== undefined)
      issues.push({
        kind: 'never-eligible-placement',
        severity: 'error',
        ref: `placement:${p.id}`,
        message: `Eligibility "${bad}" of ${p.id} can never be true — the placement is never shown`,
      });
  }

  const maxNodes = options.maxNodes ?? 20000;
  const search = findWitnesses(c, maxNodes, options.skill ?? 0.5);
  for (const s of states) {
    if (reached.has(s) && search.witnesses[s] === undefined) {
      issues.push({
        kind: 'not-reached-concretely',
        severity: search.complete ? 'error' : 'warning',
        ref: `state:${s}`,
        message: search.complete
          ? `Screen ${s} is connected but no sequence of allowed steps reaches it (guards/preconditions block every path)`
          : `Screen ${s} was not reached within ${String(maxNodes)} explored states (raise maxNodes to search further)`,
      });
    }
  }
  return {
    states: states.length,
    transitions: c.transitions.length,
    issues,
    witnesses: search.witnesses,
    explored: { nodes: search.nodes, complete: search.complete, maxNodes },
  };
}
