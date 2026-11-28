import { Badge, Empty, Section, fmt } from '../components/ui.tsx';
import { useStudio } from '../store.ts';
import { VariantToggle } from './Parameters.tsx';

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        aria-label={label}
        onChange={(e) => {
          const n = Math.trunc(Number(e.target.value));
          if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
        }}
      />
    </label>
  );
}

/** View 7 — Scenario runner (Web Workers). */
export function Scenario() {
  const {
    model,
    scenario,
    setScenario,
    simulate,
    runExplore,
    runSensitivity,
    busy,
    progress,
    runs,
    setView,
    active,
  } = useStudio();
  if (model === undefined)
    return (
      <Section title="Scenario">
        <Empty>No Game Model loaded yet.</Empty>
      </Section>
    );
  const running = busy !== undefined;
  return (
    <Section title="Scenario" actions={<VariantToggle />}>
      <div className="form-row">
        <NumberField
          label="Days"
          value={scenario.days}
          min={1}
          max={90}
          onChange={(days) => {
            setScenario({ days });
          }}
        />
        <NumberField
          label="Players per persona"
          value={scenario.players}
          min={1}
          max={5000}
          onChange={(players) => {
            setScenario({ players });
          }}
        />
        <NumberField
          label="Seed"
          value={scenario.seed}
          min={-2147483648}
          max={2147483647}
          onChange={(seed) => {
            setScenario({ seed });
          }}
        />
      </div>
      <fieldset className="personas">
        <legend>Personas</legend>
        {model.personas.map((p) => (
          <label key={p.id} className="check">
            <input
              type="checkbox"
              checked={scenario.personas.includes(p.id)}
              onChange={(e) => {
                setScenario({
                  personas: e.target.checked
                    ? model.personas
                        .map((x) => x.id)
                        .filter((x) => x === p.id || scenario.personas.includes(x))
                    : scenario.personas.filter((x) => x !== p.id),
                });
              }}
            />
            {p.name ?? p.id} <span className="muted">({fmt(p.share * 100)} %)</span>
            {p.provenance.status === 'assumed' ? <Badge tone="warn">assumed</Badge> : null}
          </label>
        ))}
      </fieldset>
      <div className="form-row">
        <button
          type="button"
          className="primary"
          disabled={running || scenario.personas.length === 0}
          onClick={() => void simulate(['A'])}
        >
          Run A
        </button>
        <button
          type="button"
          disabled={running || scenario.personas.length === 0}
          onClick={() => void simulate(['B'])}
        >
          Run B
        </button>
        <button
          type="button"
          disabled={running || scenario.personas.length === 0}
          onClick={() => void simulate(['A', 'B'])}
        >
          Run A and B
        </button>
        <button type="button" disabled={running} onClick={() => void runExplore()}>
          Explore {active} (reachability, exploits)
        </button>
        <button type="button" disabled={running} onClick={() => void runSensitivity()}>
          Sensitivity of {active}
        </button>
      </div>
      {busy === undefined ? null : (
        <p aria-live="polite">
          Running {busy}…{' '}
          {progress === undefined
            ? ''
            : `${String(progress.done)}/${String(progress.total)} worker tasks`}
          <progress value={progress?.done ?? 0} max={progress?.total ?? 1} />
        </p>
      )}
      <table className="table" aria-label="Runs">
        <thead>
          <tr>
            <th>Variant</th>
            <th>Players</th>
            <th>Days</th>
            <th>Seed</th>
            <th>Overrides</th>
            <th>Time</th>
            <th>Output hash</th>
          </tr>
        </thead>
        <tbody>
          {(['A', 'B'] as const).map((v) => {
            const r = runs[v];
            if (r === undefined)
              return (
                <tr key={v}>
                  <td>{v}</td>
                  <td colSpan={6} className="muted">
                    not run
                  </td>
                </tr>
              );
            const rec = r.result.record;
            return (
              <tr key={v}>
                <td>{v}</td>
                <td>
                  {rec.playersPerPersona} × {rec.personas.length}
                </td>
                <td>{rec.days}</td>
                <td>{rec.seed}</td>
                <td>
                  {Object.entries(r.params)
                    .map(([k, x]) => `${k}=${String(x)}`)
                    .join(', ') || '—'}
                </td>
                <td>{(r.ms / 1000).toFixed(1)} s</td>
                <td>
                  <code data-testid={`hash-${v}`}>{rec.outputHash}</code>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {runs.A === undefined && runs.B === undefined ? null : (
        <button
          type="button"
          onClick={() => {
            setView('outcomes');
          }}
        >
          See outcomes
        </button>
      )}
      <p className="muted">
        Same model, seed and settings give byte-identical results here, in the CLI (
        <code>
          gamex sim --seed {scenario.seed} --days {scenario.days} --players {scenario.players}
        </code>
        ) and in CI.
      </p>
    </Section>
  );
}
