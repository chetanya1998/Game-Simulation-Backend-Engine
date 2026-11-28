import { useState } from 'react';
import { validateGameModel, serializeGameModel } from '@gamex/model';
import { Badge, Empty, Section, fmt } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { download, readAsBase64 } from '../lib/files.ts';
import { applyParams, cleanParams } from '../lib/variants.ts';
import { useStudio, type Plan } from '../store.ts';

const ACCEPT = '.md,.markdown,.txt,.pdf,.json,.yaml,.yml,.toml';

/** View 1 — Upload & sources. */
export function Sources() {
  const { mode, server, task, refresh, notify, setView, loadModel, model, variants, active } =
    useStudio();
  const [plan, setPlan] = useState<Plan | undefined>(undefined);
  const [provider, setProvider] = useState<string | undefined>(undefined);
  const [llm, setLlm] = useState('');

  if (mode === 'static') {
    return (
      <>
        <Section title="Import a Game Model">
          <p>
            Static mode: everything runs in this browser, offline. Import a{' '}
            <code>game-model.json</code> to explore, simulate and export it. Uploading design
            documents and AI extraction need the local server: run <code>gamex studio</code> in your
            game repo.
          </p>
          <label className="file">
            <span>Choose game-model.json</span>
            <input
              type="file"
              accept=".json,application/json"
              aria-label="Import Game Model"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file === undefined) return;
                void file.text().then((text) => {
                  const r = validateGameModel(text, { source: file.name });
                  if (r.model === undefined || !r.ok) {
                    notify({
                      kind: 'error',
                      text: `${file.name} is not a valid Game Model: ${r.issues
                        .filter((i) => i.severity === 'error')
                        .slice(0, 3)
                        .map((i) => i.message)
                        .join('; ')}`,
                    });
                    return;
                  }
                  loadModel(r.model);
                  notify({
                    kind: 'success',
                    text: `Loaded ${r.model.meta.name} (${String(r.model.stateMachine.states.length)} screens).`,
                  });
                  setView('parameters');
                });
              }}
            />
          </label>
        </Section>
        {model === undefined ? null : (
          <Section title="Export">
            <p>
              Working model: <strong>{model.meta.name}</strong> (version {model.meta.modelVersion}).
            </p>
            <button
              type="button"
              onClick={() => {
                const out = applyParams(model, cleanParams(model, variants[active]));
                download('game-model.json', serializeGameModel(out), 'application/json');
              }}
            >
              Download game-model.json (variant {active})
            </button>
          </Section>
        )}
      </>
    );
  }

  const providers = server?.providers ?? { anthropic: false, agent: true, recorded: false };
  const chosen = provider ?? server?.defaultProvider ?? 'anthropic';
  const confirmed = server?.plan ?? null;

  return (
    <>
      <Section title="Design documents">
        <p>
          Add your GDD or other design documents. They are saved to <code>gamex/sources/</code> in{' '}
          <strong>{server?.repo}</strong> (never overwriting a file) so extraction, provenance and
          drift checks can cite them.
        </p>
        <label className="file">
          <span>Upload documents</span>
          <input
            type="file"
            multiple
            accept={ACCEPT}
            aria-label="Upload design documents"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              void task('upload', async () => {
                for (const file of files) {
                  await api('POST', '/api/upload', {
                    name: file.name,
                    contentBase64: await readAsBase64(file),
                  });
                }
                await refresh();
                setPlan(undefined);
                notify({
                  kind: 'success',
                  text: `Uploaded ${files.map((f) => f.name).join(', ')}.`,
                });
              });
            }}
          />
        </label>
        {server?.sources.length === 0 ? (
          <p className="muted">
            No uploaded documents yet. Documents already in the repo (README, docs/, config, tuning
            code) are found automatically.
          </p>
        ) : (
          <ul className="list">
            {server?.sources.map((s) => (
              <li key={s}>
                <code>gamex/sources/{s}</code>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Files to send"
        actions={
          <button
            type="button"
            onClick={() => {
              void task('plan', async () => {
                setPlan(await api<Plan>('POST', '/api/ingest/plan', {}));
              });
            }}
          >
            Scan repository
          </button>
        }
      >
        {plan === undefined ? (
          confirmed === null ? (
            <Empty>
              Scan the repository to see exactly which files would be sent to the LLM — and which
              are excluded, and why.
            </Empty>
          ) : (
            <p>
              <Badge tone="ok">confirmed</Badge> {confirmed.files.length} files (
              {fmt(confirmed.totalBytes / 1024, 3)} KB):{' '}
              {confirmed.files.map((f) => f.path).join(', ')}
            </p>
          )
        ) : (
          <>
            <table className="table" aria-label="Files to send">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Kind</th>
                  <th>Size</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {plan.files.map((f) => (
                  <tr key={f.path}>
                    <td>
                      <code>{f.path}</code>
                    </td>
                    <td>{f.kind}</td>
                    <td>{fmt(f.bytes / 1024, 3)} KB</td>
                    <td>{f.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <details>
              <summary>Excluded ({plan.excluded.length})</summary>
              <ul className="list">
                {plan.excluded.map((e) => (
                  <li key={e.path}>
                    <code>{e.path}</code> — {e.reason}
                  </li>
                ))}
              </ul>
            </details>
            <p>
              About {fmt(plan.estimate?.inputTokens ?? 0)} input tokens over{' '}
              {plan.estimate?.requests ?? 0} requests (before caching).
            </p>
            <button
              type="button"
              className="primary"
              onClick={() => {
                void task('confirm', async () => {
                  await api('POST', '/api/ingest/confirm', {
                    files: plan.files.map((f) => ({ path: f.path, sha256: f.sha256 })),
                  });
                  await refresh();
                  setPlan(undefined);
                  notify({
                    kind: 'success',
                    text: `Confirmed ${String(plan.files.length)} files.`,
                  });
                });
              }}
            >
              Confirm these {plan.files.length} files
            </button>
          </>
        )}
      </Section>

      <Section title="Extract">
        <div className="form-row">
          <label>
            Provider
            <select
              value={chosen}
              onChange={(e) => {
                setProvider(e.target.value);
              }}
              aria-label="Extraction provider"
            >
              <option value="anthropic" disabled={!providers.anthropic}>
                Claude (Anthropic API){providers.anthropic ? '' : ' — set ANTHROPIC_API_KEY'}
              </option>
              <option value="agent">My own agent session (handoff files)</option>
              <option value="recorded" disabled={!providers.recorded}>
                Recorded answers{providers.recorded ? '' : ' — start with --recordings'}
              </option>
            </select>
          </label>
          {chosen === 'anthropic' ? (
            <label>
              Model
              <input
                value={llm}
                placeholder="claude-opus-5-5"
                onChange={(e) => {
                  setLlm(e.target.value);
                }}
                aria-label="LLM model"
              />
            </label>
          ) : null}
          <button
            type="button"
            className="primary"
            disabled={confirmed === null}
            onClick={() => {
              void task('extract', async () => {
                const r = await api<{ done: boolean; pending?: string[] }>('POST', '/api/extract', {
                  provider: chosen,
                  ...(llm.trim() === '' ? {} : { model: llm.trim() }),
                });
                await refresh();
                if (r.done) {
                  notify({
                    kind: 'success',
                    text: 'Extraction finished. Review the candidate next.',
                  });
                  setView('review');
                } else {
                  notify({
                    kind: 'info',
                    text: `${String(r.pending?.length ?? 0)} request(s) are waiting in gamex/.work/handoff/requests/ — answer them with your agent, then extract again.`,
                  });
                }
              });
            }}
          >
            Extract candidate model
          </button>
        </div>
        {confirmed === null ? <p className="muted">Confirm the file list first.</p> : null}
      </Section>
    </>
  );
}
