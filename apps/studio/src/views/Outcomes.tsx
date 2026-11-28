import { useMemo, useState } from 'react';
import type { SimulationResult } from '@gamex/engine';
import { idToKey, type GameModel } from '@gamex/model';
import { EChart } from '../components/EChart.tsx';
import { Badge, Empty, Section, fmt } from '../components/ui.tsx';
import { useStudio, type VariantId } from '../store.ts';
import { resolveTheme } from '../theme.ts';

export function useThemeName(): string {
  const theme = useStudio((s) => s.theme);
  return resolveTheme(
    theme,
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
}

export function retentionOption(runs: { label: string; result: SimulationResult }[]) {
  const days = Math.max(...runs.map((r) => r.result.record.days));
  return {
    xAxis: {
      type: 'category',
      name: 'day',
      data: Array.from({ length: days }, (_, i) => String(i + 1)),
    },
    yAxis: { type: 'value', name: 'retention', min: 0, max: 1 },
    series: runs.flatMap(({ label, result }) =>
      result.personas.map((p) => ({
        type: 'line',
        name: `${label}${p.id}`,
        data: p.daily.map((d) => d.retention),
        showSymbol: false,
      })),
    ),
  };
}

function balanceOption(model: GameModel, result: SimulationResult) {
  const days = result.record.days;
  const keys = model.resources.map((r) => idToKey(r.id));
  return {
    xAxis: {
      type: 'category',
      name: 'day',
      data: Array.from({ length: days }, (_, i) => String(i + 1)),
    },
    yAxis: { type: 'value', name: 'mean balance' },
    tooltip: { trigger: 'axis' },
    series: result.personas.flatMap((p) =>
      keys.map((k) => ({
        type: 'line',
        name: keys.length === 1 ? p.id : `${p.id} ${k}`,
        data: p.daily.map((d) => d.values[k]?.mean ?? null),
        showSymbol: false,
      })),
    ),
  };
}

function KpiCards({ result }: { result: SimulationResult }) {
  return (
    <div className="cards">
      {result.kpis.map((k) => (
        <div key={k.id} className="card" title={k.note ?? k.metric}>
          <div className="card__label">{k.id}</div>
          <div className="card__value" data-kpi={k.key}>
            {fmt(k.value)}
          </div>
          <div className="card__sub">
            {k.metric}
            {k.persona === null ? '' : ` · ${k.persona}`}
          </div>
        </div>
      ))}
    </div>
  );
}

/** View 8 — Outcomes dashboard. */
export function Outcomes() {
  const { model, runs, explore, sensitivity } = useStudio();
  const theme = useThemeName();
  const available = (['A', 'B'] as VariantId[]).filter((v) => runs[v] !== undefined);
  const [which, setWhich] = useState<VariantId>('A');
  const v = available.includes(which) ? which : available[0];
  const run = v === undefined ? undefined : runs[v];
  const kpiKeys = Object.keys(sensitivity?.tornado ?? {});
  const [kpi, setKpi] = useState<string | undefined>(undefined);
  const tornadoKey = kpi !== undefined && kpiKeys.includes(kpi) ? kpi : kpiKeys[0];
  const tornado = useMemo(() => {
    if (sensitivity === undefined || tornadoKey === undefined) return undefined;
    const base = sensitivity.baseline[tornadoKey] ?? 0;
    const rows = (sensitivity.tornado[tornadoKey] ?? [])
      .filter((e) => e.delta !== null && e.delta !== 0)
      .slice(0, 12)
      .reverse();
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'value', name: `${tornadoKey} change` },
      yAxis: { type: 'category', data: rows.map((e) => e.constant) },
      series: [
        {
          type: 'bar',
          name: 'at min',
          barGap: '-100%',
          data: rows.map((e) => (e.kpiAtLow ?? base) - base),
        },
        {
          type: 'bar',
          name: 'at max',
          data: rows.map((e) => (e.kpiAtHigh ?? base) - base),
        },
      ],
    };
  }, [sensitivity, tornadoKey]);

  if (model === undefined)
    return (
      <Section title="Outcomes">
        <Empty>No Game Model loaded yet.</Empty>
      </Section>
    );
  return (
    <>
      <Section
        title="Outcomes"
        actions={
          available.length < 2 ? null : (
            <div className="toggle" role="radiogroup" aria-label="Run">
              {available.map((x) => (
                <button
                  key={x}
                  type="button"
                  role="radio"
                  aria-checked={x === v}
                  className={x === v ? 'on' : ''}
                  onClick={() => {
                    setWhich(x);
                  }}
                >
                  Run {x}
                </button>
              ))}
            </div>
          )
        }
      >
        {run === undefined ? (
          <Empty>Run a scenario first.</Empty>
        ) : (
          <>
            <p className="muted">
              Variant {v}: {run.result.record.playersPerPersona} players ×{' '}
              {run.result.record.personas.length} personas × {run.result.record.days} days, seed{' '}
              {run.result.record.seed}. Mission results come from a stylized model, not real
              gameplay.
            </p>
            <KpiCards result={run.result} />
            <h3>Retention</h3>
            <EChart
              option={retentionOption([{ label: '', result: run.result }])}
              label="Retention by day and persona"
              theme={theme}
            />
            {model.resources.length === 0 ? null : (
              <>
                <h3>Resource balance</h3>
                <EChart
                  option={balanceOption(model, run.result)}
                  label="Resource balance by day"
                  theme={theme}
                />
              </>
            )}
            <h3>Invariants</h3>
            <table className="table" aria-label="Invariants">
              <tbody>
                {run.result.invariants.map((i) => (
                  <tr key={i.id} data-invariant={i.id}>
                    <td>
                      <Badge
                        tone={
                          i.status === 'pass'
                            ? 'ok'
                            : i.status === 'fail'
                              ? i.severity === 'blocking'
                                ? 'bad'
                                : 'warn'
                              : 'muted'
                        }
                      >
                        {i.status}
                      </Badge>
                    </td>
                    <td>
                      <code>{i.id}</code>
                    </td>
                    <td>{i.message}</td>
                    <td className="muted">
                      {i.kind === 'trace' ? `${String(i.checks)} checks` : 'aggregate'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {run.result.findings.length === 0 ? null : (
              <>
                <h3>Findings</h3>
                <ul className="issues">
                  {run.result.findings.map((f, n) => (
                    <li
                      key={n}
                      className={`issue issue--${f.severity === 'blocking' ? 'error' : 'warning'}`}
                    >
                      <strong>{f.kind}</strong> {f.message}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </Section>
      <Section title="Exploration">
        {explore === undefined ? (
          <Empty>
            Run “Explore” in Scenario for reachability, exploit search and ad-placement safety.
          </Empty>
        ) : (
          <>
            <p>
              <Badge tone={explore.ok ? 'ok' : 'bad'}>
                {explore.ok ? 'no blocking problems' : 'problems found'}
              </Badge>{' '}
              {explore.reachability.explored.nodes} states explored,{' '}
              {explore.exploits.searched.nodes} adversarial states,{' '}
              {explore.placements.filter((p) => !p.safe).length} unsafe placements.
            </p>
            <ul className="issues" aria-label="Exploit findings">
              {explore.exploits.findings.map((f, n) => (
                <li
                  key={n}
                  className={`issue issue--${f.severity === 'blocking' ? 'error' : 'warning'}`}
                >
                  <strong>{f.kind}</strong> {f.message}
                  {f.prefix.length + (f.loop?.length ?? 0) === 0 ? null : (
                    <div className="muted">
                      Repro:{' '}
                      {[...f.prefix, ...(f.loop ?? [])].map((s) => JSON.stringify(s)).join(' → ')}
                    </div>
                  )}
                </li>
              ))}
              {explore.placements
                .filter((p) => !p.safe)
                .map((p) => (
                  <li key={p.placement} className="issue issue--error">
                    <code>{p.placement}</code> can appear in {p.forbiddenHits.join(', ')}
                  </li>
                ))}
            </ul>
          </>
        )}
      </Section>
      <Section
        title="Sensitivity"
        actions={
          kpiKeys.length === 0 ? null : (
            <select
              value={tornadoKey}
              onChange={(e) => {
                setKpi(e.target.value);
              }}
              aria-label="KPI for the tornado chart"
            >
              {kpiKeys.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          )
        }
      >
        {tornado === undefined ? (
          <Empty>
            Run “Sensitivity” in Scenario: each constant is set to its min and max, one at a time.
          </Empty>
        ) : (
          <EChart
            option={tornado}
            label={`Tornado chart for ${tornadoKey ?? ''}`}
            height={360}
            theme={theme}
          />
        )}
      </Section>
    </>
  );
}
