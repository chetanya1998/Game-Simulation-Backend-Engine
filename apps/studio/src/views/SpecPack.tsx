import { useEffect, useMemo, useState } from 'react';
import { upsertAgentsSection } from '@gamex/specpack';
import { zipSync, strToU8 } from 'fflate';
import { Badge, Empty, Section } from '../components/ui.tsx';
import { pool } from '../engine/pool.ts';
import { api } from '../lib/api.ts';
import { download } from '../lib/files.ts';
import { cleanParams } from '../lib/variants.ts';
import { useStudio } from '../store.ts';

interface Rendered {
  files: { path: string; content: string; ownership: string }[];
  agentsSection: string;
  goldenCases: number;
  outputHash: string;
}
interface Plan {
  written: boolean;
  files: { path: string; action: string; reason?: string }[];
  conflicts: { path: string; reason?: string }[];
  goldenCases: number;
}

/** View 10 — Spec Pack preview & write. */
export function SpecPack() {
  const { model, mode, variants, task, notify, scenario } = useStudio();
  const [pack, setPack] = useState<Rendered | undefined>(undefined);
  const [plan, setPlan] = useState<Plan | undefined>(undefined);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const settings = useMemo(
    () => ({ seed: scenario.seed, days: scenario.days, players: Math.min(scenario.players, 100) }),
    [scenario],
  );
  const unsaved =
    model === undefined
      ? 0
      : Object.keys(cleanParams(model, variants.A)).length +
        Object.keys(cleanParams(model, variants.B)).length;

  useEffect(() => {
    setPack(undefined);
    setPlan(undefined);
  }, [model]);

  if (model === undefined)
    return (
      <Section title="Spec Pack">
        <Empty>No Game Model loaded yet.</Empty>
      </Section>
    );

  const render = () =>
    task('render', async () => {
      const r = await pool().run((w) =>
        w.renderPack(model, {
          seed: settings.seed,
          days: settings.days,
          playersPerPersona: settings.players,
        }),
      );
      // The writer merges the GameX section into AGENTS.md (keeping your own content); preview it on its own.
      r.files.unshift({
        path: 'AGENTS.md',
        content: upsertAgentsSection(undefined, r.agentsSection),
        ownership: 'section',
      });
      setPack(r);
      setSelected(r.files.find((f) => f.path === 'gamex/README.md')?.path ?? r.files[0]?.path);
      if (mode === 'server') setPlan(await api<Plan>('POST', '/api/specpack/preview', settings));
    });

  const file = pack?.files.find((f) => f.path === selected);
  const action = new Map((plan?.files ?? []).map((f) => [f.path, f]));
  return (
    <Section
      title="Spec Pack"
      actions={
        <>
          <button type="button" onClick={() => void render()}>
            {pack === undefined ? 'Preview' : 'Refresh preview'}
          </button>
          {mode === 'server' ? (
            <button
              type="button"
              className="primary"
              disabled={pack === undefined || (plan?.conflicts.length ?? 0) > 0}
              onClick={() =>
                void task('write', async () => {
                  const r = await api<Plan>('POST', '/api/specpack/write', settings);
                  setPlan(r);
                  notify({
                    kind: r.written ? 'success' : 'error',
                    text: r.written
                      ? `Spec Pack written: ${String(r.files.filter((f) => f.action === 'create' || f.action === 'update').length)} files changed, ${String(r.goldenCases)} golden cases.`
                      : `Not written: ${String(r.conflicts.length)} conflict(s).`,
                  });
                })
              }
            >
              Write Spec Pack to repo
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={pack === undefined}
              onClick={() => {
                if (pack === undefined) return;
                const entries: Record<string, Uint8Array> = {};
                for (const f of pack.files) entries[f.path] = strToU8(f.content);
                download(
                  `${model.meta.name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-spec-pack.zip`,
                  zipSync(entries, { level: 6 }),
                  'application/zip',
                );
              }}
            >
              Download as zip
            </button>
          )}
        </>
      }
    >
      <p className="muted">
        Generated from {mode === 'server' ? 'the saved gamex/game-model.json' : 'the working model'}{' '}
        (version {model.meta.modelVersion}) with seed {settings.seed}, {settings.days} days,{' '}
        {settings.players} players per persona for the report.
        {unsaved > 0
          ? ` ${String(unsaved)} unsaved variant change(s) are not included — save a variant in Parameters first.`
          : ''}
      </p>
      {pack === undefined ? (
        <Empty>
          Preview the files GameX would write: AGENTS.md section, balance files, formulas, backend
          contracts, golden tests and tasks.
        </Empty>
      ) : (
        <>
          <p>
            {pack.files.length} files, {pack.goldenCases} golden cases.{' '}
            {plan === undefined ? null : plan.conflicts.length > 0 ? (
              <Badge tone="bad">{plan.conflicts.length} conflict(s) with hand edits</Badge>
            ) : (
              <Badge tone="ok">
                {plan.files.filter((f) => f.action === 'create').length} new,{' '}
                {plan.files.filter((f) => f.action === 'update').length} changed,{' '}
                {plan.files.filter((f) => f.action === 'unchanged').length} unchanged
              </Badge>
            )}
          </p>
          <div className="pack">
            <ul className="pack__files" aria-label="Spec Pack files">
              {pack.files.map((f) => (
                <li key={f.path}>
                  <button
                    type="button"
                    className={f.path === selected ? 'on' : ''}
                    onClick={() => {
                      setSelected(f.path);
                    }}
                  >
                    {f.path}
                    {action.get(f.path) === undefined ? null : (
                      <span className={`act act--${action.get(f.path)?.action ?? ''}`}>
                        {' '}
                        {action.get(f.path)?.action}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <pre className="pack__content" aria-label={`Contents of ${selected ?? ''}`}>
              {file?.content ?? ''}
            </pre>
          </div>
        </>
      )}
    </Section>
  );
}
