import { useMemo } from 'react';
import type { GameModel } from '@gamex/model';
import { FlowGraph, type GraphEdge, type GraphNode } from '../components/FlowGraph.tsx';
import { Badge, Empty, Section } from '../components/ui.tsx';
import { useStudio } from '../store.ts';

function NoModel() {
  return <Empty>No Game Model loaded yet — finish the review, or import a model in Sources.</Empty>;
}

const id = (ref: string): string => ref.slice(ref.indexOf(':') + 1);

export function entityGraph(model: GameModel): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const e of model.entities) {
    nodes.push({
      id: `ent:${e.id}`,
      label: e.name ?? e.id,
      sub: e.kind,
      className: `node--${e.kind}`,
      title: e.description ?? e.id,
    });
    for (const [attr, ref] of Object.entries(e.attributes)) {
      if (!seen.has(ref)) {
        seen.add(ref);
        const c = model.constants.find((x) => `const:${x.id}` === ref);
        const v = model.variables.find((x) => `var:${x.id}` === ref);
        const value =
          c !== undefined && typeof c.value === 'number'
            ? ` = ${String(c.value)} ${c.unit}`
            : v !== undefined
              ? ` (${v.scope})`
              : '';
        nodes.push({
          id: ref,
          label: id(ref),
          sub: `${ref.startsWith('const:') ? 'constant' : 'variable'}${value}`,
          className: ref.startsWith('const:') ? 'node--constant' : 'node--variable',
        });
      }
      edges.push({ id: `${e.id}>${attr}`, source: `ent:${e.id}`, target: ref, label: attr });
    }
  }
  return { nodes, edges };
}

/** View 3 — Entity map. */
export function EntityMap() {
  const model = useStudio((s) => s.model);
  const graph = useMemo(() => (model === undefined ? undefined : entityGraph(model)), [model]);
  if (model === undefined || graph === undefined)
    return (
      <Section title="Entity map">
        <NoModel />
      </Section>
    );
  return (
    <Section title="Entity map">
      <p className="muted">
        {model.entities.length} entities (heroes, enemies, mechanics, items) and the constants and
        variables their attributes use.
      </p>
      <FlowGraph nodes={graph.nodes} edges={graph.edges} label="Entity map" />
    </Section>
  );
}

export function economyGraph(model: GameModel): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = model.flows.map((f) => ({
    id: `flow:${f.id}`,
    label: f.name ?? f.id,
    sub: `${f.kind} · ${id(f.resource)}${f.actions.length === 0 ? '' : ` · ${String(f.actions.length)} action${f.actions.length === 1 ? '' : 's'}`}`,
    className: `node--${f.kind}`,
    title: f.actions.map(id).join(', '),
  }));
  const edges: GraphEdge[] = model.flows.flatMap((f) =>
    f.to.map((t) => ({
      id: `${f.id}>${t}`,
      source: `flow:${f.id}`,
      target: t,
      label: id(f.resource),
    })),
  );
  // Rewarded placements are faucets too.
  for (const p of model.monetization.placements) {
    for (const r of p.reward ?? []) {
      if (!r.target.startsWith('res:')) continue;
      const pool = model.flows.find((f) => f.kind === 'pool' && f.resource === r.target);
      if (pool === undefined) continue;
      if (!nodes.some((n) => n.id === `placement:${p.id}`))
        nodes.push({
          id: `placement:${p.id}`,
          label: p.name ?? p.id,
          sub: `${p.format} reward`,
          className: 'node--placement',
        });
      edges.push({
        id: `${p.id}>${pool.id}`,
        source: `placement:${p.id}`,
        target: `flow:${pool.id}`,
        label: `${r.op} ${r.value}`,
      });
    }
  }
  return { nodes, edges };
}

/** View 4 — Economy flow graph. */
export function EconomyGraph() {
  const model = useStudio((s) => s.model);
  const graph = useMemo(() => (model === undefined ? undefined : economyGraph(model)), [model]);
  if (model === undefined || graph === undefined)
    return (
      <Section title="Economy flows">
        <NoModel />
      </Section>
    );
  return (
    <Section title="Economy flows">
      <p className="muted">
        Sources, pools, converters, gates and sinks per resource, plus rewarded placements that pay
        out.
      </p>
      {graph.nodes.length === 0 ? (
        <Empty>The model has no economy flows.</Empty>
      ) : (
        <FlowGraph nodes={graph.nodes} edges={graph.edges} label="Economy flow graph" />
      )}
    </Section>
  );
}

export function stateGraph(
  model: GameModel,
  problems: ReadonlySet<string>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const forbidden = new Set(model.monetization.forbiddenStates);
  return {
    nodes: model.stateMachine.states.map((s) => ({
      id: `state:${s.id}`,
      label: `${s.code === undefined ? '' : `${s.code} `}${s.name ?? s.id}`,
      sub: `${s.kind}${forbidden.has(`state:${s.id}`) ? ' · no UI ads' : ''}`,
      className: `node--${s.kind}${problems.has(`state:${s.id}`) ? ' node--problem' : ''}${model.stateMachine.initial === `state:${s.id}` ? ' node--initial' : ''}`,
    })),
    edges: model.stateMachine.transitions
      .filter((t) => t.to !== 'return')
      .map((t) => ({
        id: t.id,
        source: t.from,
        target: t.to,
        label:
          t.trigger === 'ui'
            ? ''
            : t.trigger === 'auto'
              ? 'auto'
              : `${id(t.trigger)}${t.outcome === undefined ? '' : `:${t.outcome}`}`,
        className: problems.has(`transition:${t.id}`) ? 'edge--problem' : '',
      })),
  };
}

/** View 5 — State machine with reachability problems highlighted. */
export function StateMachine() {
  const { model, reachability } = useStudio();
  const problems = useMemo(
    () =>
      new Set(
        (reachability?.issues ?? []).flatMap((i) => [
          i.ref,
          ...(i.states ?? []).map((s) => (s.includes(':') ? s : `state:${s}`)),
        ]),
      ),
    [reachability],
  );
  const graph = useMemo(
    () => (model === undefined ? undefined : stateGraph(model, problems)),
    [model, problems],
  );
  if (model === undefined || graph === undefined)
    return (
      <Section title="State machine">
        <NoModel />
      </Section>
    );
  const issues = reachability?.issues ?? [];
  return (
    <Section title="State machine">
      <p>
        {model.stateMachine.states.length} screens, {model.stateMachine.transitions.length}{' '}
        transitions.{' '}
        {reachability === undefined ? (
          <span className="muted">Checking reachability…</span>
        ) : issues.length === 0 ? (
          <Badge tone="ok">every screen reachable, no dead ends or traps</Badge>
        ) : (
          <Badge tone={issues.some((i) => i.severity === 'error') ? 'bad' : 'warn'}>
            {issues.length} reachability issue(s)
          </Badge>
        )}
      </p>
      {issues.length === 0 ? null : (
        <ul className="issues" aria-label="Reachability issues">
          {issues.map((i) => (
            <li key={`${i.kind}:${i.ref}`} className={`issue issue--${i.severity}`}>
              <strong>{i.kind}</strong> <code>{i.ref}</code> — {i.message}
            </li>
          ))}
        </ul>
      )}
      <FlowGraph nodes={graph.nodes} edges={graph.edges} label="State machine" height={640} />
      <p className="muted">
        Overlay returns (to the paused screen) are not drawn. Red outlines mark screens and
        transitions with problems.
      </p>
    </Section>
  );
}
