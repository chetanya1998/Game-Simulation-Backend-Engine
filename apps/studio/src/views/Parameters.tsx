import { useMemo, useState } from 'react';
import { Badge, Empty, Section, fmt } from '../components/ui.tsx';
import { cleanParams, sliders } from '../lib/variants.ts';
import { useStudio, type VariantId } from '../store.ts';

export function VariantToggle() {
  const { active, setActive, variants, model } = useStudio();
  return (
    <div className="toggle" role="radiogroup" aria-label="Variant">
      {(['A', 'B'] as VariantId[]).map((v) => {
        const n = model === undefined ? 0 : Object.keys(cleanParams(model, variants[v])).length;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active === v}
            className={active === v ? 'on' : ''}
            onClick={() => {
              setActive(v);
            }}
          >
            Variant {v}
            {n === 0 ? '' : ` (${String(n)} changed)`}
          </button>
        );
      })}
    </div>
  );
}

/** View 6 — Parameter panel: sliders bound to constants, per variant. */
export function Parameters() {
  const { model, variants, active, setParam, copyVariant, saveVariant, mode } = useStudio();
  const [query, setQuery] = useState('');
  const specs = useMemo(() => (model === undefined ? [] : sliders(model)), [model]);
  if (model === undefined)
    return (
      <Section title="Parameters">
        <Empty>No Game Model loaded yet.</Empty>
      </Section>
    );
  const params = variants[active];
  const changed = cleanParams(model, params);
  const q = query.trim().toLowerCase();
  const groups = [...new Set(specs.map((s) => s.group))].sort();
  const other: VariantId = active === 'A' ? 'B' : 'A';
  return (
    <Section
      title="Parameters"
      actions={
        <>
          <VariantToggle />
          <button
            type="button"
            onClick={() => {
              copyVariant(active, other);
            }}
          >
            Copy {active} → {other}
          </button>
          <button
            type="button"
            disabled={Object.keys(changed).length === 0}
            onClick={() => void saveVariant(active)}
          >
            {mode === 'server'
              ? `Save ${active} to game-model.json`
              : `Make ${active} the working model`}
          </button>
        </>
      }
    >
      <p className="muted">
        Changes are overrides for variant {active} until you save them.{' '}
        {Object.keys(changed).length} changed. Assumed values are marked — they are placeholders,
        not decisions.
      </p>
      <label>
        Filter{' '}
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          placeholder="constant name or key"
          aria-label="Filter parameters"
        />
      </label>
      {groups.map((g) => {
        const rows = specs.filter(
          (s) =>
            s.group === g &&
            (q === '' || s.key.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)),
        );
        if (rows.length === 0) return null;
        return (
          <fieldset key={g} className="params">
            <legend>{g}</legend>
            {rows.map((s) => {
              const value = params[s.key] ?? s.value;
              const isChanged = changed[s.key] !== undefined;
              return (
                <div key={s.key} className={`param${isChanged ? ' param--changed' : ''}`}>
                  <label htmlFor={`p-${s.key}`} title={s.id}>
                    {s.name} {s.assumed ? <Badge tone="warn">assumed</Badge> : null}
                    <span className="muted"> {s.key}</span>
                  </label>
                  <input
                    id={`p-${s.key}`}
                    type="range"
                    min={s.min}
                    max={s.max}
                    step={s.step}
                    value={value}
                    aria-label={`${s.key} slider`}
                    onChange={(e) => {
                      setParam(s.key, Number(e.target.value));
                    }}
                  />
                  <input
                    type="number"
                    className="param__number"
                    min={s.min}
                    max={s.max}
                    step={s.step}
                    value={value}
                    aria-label={`${s.key} value`}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) setParam(s.key, n);
                    }}
                  />
                  <span className="param__unit">{s.unit}</span>
                  <button
                    type="button"
                    className="link"
                    disabled={!isChanged}
                    onClick={() => {
                      setParam(s.key, undefined);
                    }}
                    aria-label={`Reset ${s.key}`}
                  >
                    reset ({fmt(s.value)})
                  </button>
                </div>
              );
            })}
          </fieldset>
        );
      })}
    </Section>
  );
}
