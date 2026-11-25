import type { GameModel, Gap, Provenance } from '@gamex/model';
import { toId } from './ids.js';
import type { Dropped } from './repair.js';

export interface Conflict {
  readonly ref: string;
  readonly chosen: { readonly source: string; readonly location: string; readonly value: string };
  readonly others: readonly {
    readonly source: string;
    readonly location: string;
    readonly value: string;
  }[];
}

export interface GapInputs {
  readonly conflicts: readonly Conflict[];
  readonly dropped: readonly Dropped[];
  /** Refs whose quote was not found, or whose number is not in the cited line. */
  readonly unverified: readonly string[];
  readonly defaultPersonas: boolean;
}

function derived(excerpt: string): Provenance {
  return {
    source: 'gamex:derived',
    location: '',
    excerpt: excerpt.slice(0, 200),
    confidence: 'high',
    status: 'detected',
  };
}

function nodeRefs(model: GameModel): Map<string, string> {
  const out = new Map<string, string>();
  const add = (prefix: string, nodes: readonly { id: string; provenance: Provenance }[]): void => {
    for (const n of nodes) out.set(`${prefix}:${n.id}`, n.provenance.status);
  };
  add('ent', model.entities);
  add('res', model.resources);
  add('const', model.constants);
  add('var', model.variables);
  add('action', model.actions);
  add('rule', model.rules);
  add('state', model.stateMachine.states);
  add('transition', model.stateMachine.transitions);
  add('flow', model.flows);
  add('placement', model.monetization.placements);
  add('persona', model.personas);
  add('kpi', model.kpis);
  add('inv', model.invariants);
  return out;
}

/**
 * Gaps that follow from the extraction itself, by fixed rules: conflicting sources, removed
 * proposals, unverifiable evidence, default personas, missing revenue assumptions, and any assumed
 * item no gap covers yet.
 */
export function derivedGaps(model: GameModel, inputs: GapInputs): Gap[] {
  const refs = nodeRefs(model);
  const ids = new Set(model.gaps.map((g) => g.id));
  const out: Gap[] = [];
  const add = (gap: Omit<Gap, 'related'> & { related: string[] }): void => {
    if (ids.has(gap.id)) return;
    ids.add(gap.id);
    out.push({ ...gap, related: [...new Set(gap.related.filter((r) => refs.has(r)))] });
  };

  for (const c of inputs.conflicts) {
    const others = c.others
      .map((o) => `${o.value} (${o.source}${o.location === '' ? '' : ` ${o.location}`})`)
      .join(', ');
    add({
      id: toId(`gap-conflict-${c.ref.split(':')[1] ?? c.ref}`),
      kind: 'contradiction',
      question: `Sources disagree on ${c.ref}: ${c.chosen.value} (${c.chosen.source} ${c.chosen.location}) was used; also stated: ${others}. Which is right?`,
      related: [c.ref],
      blocking: false,
      provenance: derived(`Conflicting values for ${c.ref}.`),
    });
  }
  const removedNodes = inputs.dropped.filter((d) => d.in === undefined);
  if (removedNodes.length > 0) {
    add({
      id: 'gap-extraction-dropped',
      kind: 'ambiguous',
      question: `These proposals were incomplete or inconsistent and were left out: ${removedNodes
        .map((d) => `${d.ref} — ${d.reason}`)
        .join('; ')}. Add them by hand if they matter.`,
      related: [],
      blocking: false,
      provenance: derived('Proposals removed during assembly.'),
    });
  }
  if (inputs.unverified.length > 0) {
    add({
      id: 'gap-unverified-evidence',
      kind: 'ambiguous',
      question: `The cited text could not be found (or does not state the value) for: ${inputs.unverified.join(', ')}. Check these against the sources.`,
      related: [...inputs.unverified],
      blocking: false,
      provenance: derived('Evidence that did not match the sources.'),
    });
  }
  if (inputs.defaultPersonas) {
    add({
      id: 'gap-personas',
      kind: 'assumption',
      question:
        'The player personas (shares, sessions, skill, ad opt-in, purchase and churn rates) are generic defaults. Replace them with real segments or analytics.',
      related: model.personas.map((p) => `persona:${p.id}`),
      blocking: false,
      provenance: derived('Default personas.'),
    });
  }
  const ads = model.monetization.placements.filter((p) => p.format !== 'iap');
  if (model.monetization.assumptions === undefined && ads.length > 0) {
    add({
      id: 'gap-ad-revenue-assumptions',
      kind: 'missing',
      question:
        'What are the expected eCPM and fill rate per ad format in the target markets? Without them, ad revenue is not simulated.',
      related: ads.map((p) => `placement:${p.id}`),
      blocking: false,
      provenance: derived('No revenue assumptions in the inputs.'),
    });
  }
  const covered = new Set([...model.gaps, ...out].flatMap((g) => g.related));
  const uncovered = [...refs]
    .filter(([r, status]) => status === 'assumed' && !covered.has(r))
    .map(([r]) => r);
  if (uncovered.length > 0) {
    add({
      id: 'gap-assumed-values',
      kind: 'assumption',
      question: `These items are placeholders or assumptions, not decisions: ${uncovered.join(', ')}. Confirm or replace them.`,
      related: uncovered,
      blocking: false,
      provenance: derived('Assumed items not covered by another gap.'),
    });
  }
  return out;
}
