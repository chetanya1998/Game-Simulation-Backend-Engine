import { EChart } from '../components/EChart.tsx';
import { Badge, Empty, Section, fmt } from '../components/ui.tsx';
import { useStudio } from '../store.ts';
import { retentionOption, useThemeName } from './Outcomes.tsx';

/** View 9 — Variant compare (A vs B on the same seed: common random numbers). */
export function Compare() {
  const { runs, simulate, busy } = useStudio();
  const theme = useThemeName();
  const a = runs.A;
  const b = runs.B;
  if (a === undefined || b === undefined) {
    return (
      <Section title="Compare A vs B">
        <Empty>
          Run both variants to compare them.{' '}
          <button
            type="button"
            disabled={busy !== undefined}
            onClick={() => void simulate(['A', 'B'])}
          >
            Run A and B
          </button>
        </Empty>
      </Section>
    );
  }
  const same =
    a.result.record.seed === b.result.record.seed &&
    a.result.record.days === b.result.record.days &&
    a.result.record.playersPerPersona === b.result.record.playersPerPersona;
  const keys = [...new Set([...Object.keys(a.params), ...Object.keys(b.params)])].sort();
  const bKpis = new Map(b.result.kpis.map((k) => [k.id, k]));
  const bInv = new Map(b.result.invariants.map((i) => [i.id, i]));
  return (
    <>
      <Section title="Compare A vs B">
        {same ? null : (
          <p className="warn">
            The two runs used different seeds, days or player counts; differences are not only due
            to the parameters.
          </p>
        )}
        <h3>Parameters</h3>
        {keys.length === 0 ? (
          <p className="muted">Both variants use the model's values.</p>
        ) : (
          <table className="table" aria-label="Parameter differences">
            <thead>
              <tr>
                <th>Constant</th>
                <th>A</th>
                <th>B</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k}>
                  <td>
                    <code>{k}</code>
                  </td>
                  <td>{a.params[k] === undefined ? 'model' : fmt(a.params[k])}</td>
                  <td>{b.params[k] === undefined ? 'model' : fmt(b.params[k])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <h3>KPIs</h3>
        <table className="table" aria-label="KPI comparison">
          <thead>
            <tr>
              <th>KPI</th>
              <th>A</th>
              <th>B</th>
              <th>Δ</th>
              <th>Δ %</th>
            </tr>
          </thead>
          <tbody>
            {a.result.kpis.map((k) => {
              const bv = bKpis.get(k.id)?.value ?? null;
              const delta = k.value === null || bv === null ? null : bv - k.value;
              const pct =
                delta === null || k.value === null || k.value === 0
                  ? null
                  : (delta / Math.abs(k.value)) * 100;
              return (
                <tr key={k.id} data-kpi={k.id}>
                  <td>
                    <code>{k.id}</code>
                  </td>
                  <td>{fmt(k.value)}</td>
                  <td>{fmt(bv)}</td>
                  <td className={delta === null || delta === 0 ? '' : delta > 0 ? 'up' : 'down'}>
                    {delta === null ? '—' : `${delta > 0 ? '+' : ''}${fmt(delta)}`}
                  </td>
                  <td>{pct === null ? '—' : `${pct > 0 ? '+' : ''}${pct.toFixed(1)} %`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <h3>Invariants</h3>
        <ul className="list" aria-label="Invariant comparison">
          {a.result.invariants.map((i) => {
            const other = bInv.get(i.id);
            const tone = (s: string | undefined) =>
              s === 'pass' ? 'ok' : s === 'fail' ? 'bad' : 'muted';
            return (
              <li key={i.id}>
                <code>{i.id}</code> A <Badge tone={tone(i.status)}>{i.status}</Badge> B{' '}
                <Badge tone={tone(other?.status)}>{other?.status ?? '—'}</Badge>
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title="Retention, A vs B">
        <EChart
          option={retentionOption([
            { label: 'A ', result: a.result },
            { label: 'B ', result: b.result },
          ])}
          label="Retention of A and B"
          theme={theme}
        />
      </Section>
    </>
  );
}
