import type { ExploreReport, SensitivityResult, SimulationResult } from '@gamex/engine';
import { MD_HEADER, code, mdTable, type FileMap } from './common.js';

export interface ReportInput {
  readonly sim: SimulationResult;
  readonly explore: ExploreReport;
  readonly sensitivity?: SensitivityResult | undefined;
}

/** gamex/reports/latest-sim.md — key findings, invariants, KPIs, exploration and (optionally) sensitivity. */
export function renderReport(input: ReportInput, files: FileMap): void {
  const { sim, explore, sensitivity } = input;
  const r = sim.record;
  const failing = sim.invariants.filter((i) => i.status === 'fail');
  const blocking = explore.exploits.findings.filter((f) => f.severity === 'blocking');
  const reachErrors = explore.reachability.issues.filter((i) => i.severity === 'error');
  const summary = [
    failing.length === 0
      ? '- ✅ All invariants that were exercised hold.'
      : `- ❌ ${String(failing.length)} invariant(s) fail: ${failing.map((i) => code(i.id)).join(', ')}.`,
    reachErrors.length === 0
      ? '- ✅ No reachability errors in the screen flow.'
      : `- ❌ ${String(reachErrors.length)} reachability error(s).`,
    blocking.length === 0
      ? '- ✅ Exploit search found no reward loops or rule violations.'
      : `- ❌ ${String(blocking.length)} blocking exploit finding(s).`,
    explore.placements.every((p) => p.safe)
      ? '- ✅ No UI ad can appear in a forbidden screen.'
      : '- ❌ Some placements can appear in forbidden screens.',
    ...sim.findings.map((f) => `- ${f.severity === 'blocking' ? '❌' : '⚠️'} ${f.message}`),
  ];
  const personaRows = sim.personas.map((p) => [
    p.id,
    String(p.players),
    String(p.daily[0]?.retention ?? 0),
    String(p.daily.at(-1)?.retention ?? 0),
    String(p.churned),
  ]);
  const tornado =
    sensitivity === undefined
      ? '_Not run. Use `gamex sync --sensitivity` (slower) to rank which constants move each KPI most._'
      : Object.entries(sensitivity.tornado)
          .map(
            ([kpi, entries]) =>
              `**${kpi}**: ${
                entries
                  .filter((e) => (e.delta ?? 0) !== 0)
                  .slice(0, 5)
                  .map((e) => `${code(e.constant)} (${String(e.delta)})`)
                  .join(', ') || 'no constant moves it'
              }`,
          )
          .join('\n\n');
  files.set('gamex/reports/latest-sim.md', {
    ownership: 'generated',
    content: `${MD_HEADER}

# Simulation report — ${r.model.name}

Seed ${String(r.seed)}, ${String(r.days)} days, ${String(r.playersPerPersona)} players per persona, engine ${r.engineVersion}.
Model content hash ${code(r.model.contentHash.slice(0, 16))}, output hash ${code(r.outputHash.slice(0, 16))} — rerun with the same
seed to reproduce. Results come from the stated persona assumptions: they compare designs, they do not predict
real players.

## Key findings

${summary.join('\n')}

## Invariants

${mdTable(
  ['Invariant', 'Kind', 'Severity', 'Status', 'Checks', 'Detail'],
  sim.invariants.map((i) => [i.id, i.kind, i.severity, i.status, String(i.checks), i.message]),
)}

## KPIs

${mdTable(
  ['KPI', 'Metric', 'Persona', 'Value', 'Note'],
  sim.kpis.map((k) => [
    k.id,
    k.metric,
    k.persona ?? 'all',
    k.value === null ? '—' : String(k.value),
    k.note ?? '',
  ]),
)}

## Personas

${mdTable(['Persona', 'Players', 'Day-1 retention', `Day-${String(r.days)} retention`, 'Churned'], personaRows)}

## Exploration

- Screens: ${String(explore.reachability.states)}, transitions: ${String(explore.reachability.transitions)}, concrete states explored: ${String(explore.reachability.explored.nodes)}.
- Reachability issues: ${explore.reachability.issues.length === 0 ? 'none' : explore.reachability.issues.map((i) => `${i.kind} ${code(i.ref)}`).join(', ')}.
- Exploit search: ${String(explore.exploits.searched.nodes)} states; findings: ${explore.exploits.findings.length === 0 ? 'none' : explore.exploits.findings.map((f) => f.message).join('; ')}.
- Best resource gain per simulated minute (adversarial): ${
      Object.entries(explore.exploits.bestRatePerMinute)
        .map(([k, v]) => `${k} ${String(v)}`)
        .join(', ') || '—'
    }.

## Sensitivity

${tornado}
`,
  });
}
