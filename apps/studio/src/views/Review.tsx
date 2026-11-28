import { useEffect, useMemo, useState } from 'react';
import { Badge, Empty, Section } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import {
  decide,
  decisionOf,
  itemsOf,
  KINDS,
  type Decision,
  type Item,
  type ReviewLedger,
} from '../lib/ledger.ts';
import { useStudio } from '../store.ts';

const TONE = {
  approve: 'ok',
  assume: 'warn',
  edit: 'info',
  reject: 'bad',
  pending: 'muted',
} as const;

function EditBox({
  item,
  onSave,
  onCancel,
}: {
  item: Item;
  onSave: (set: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const fields = Object.fromEntries(
    Object.entries(item.node).filter(([k]) => k !== 'id' && k !== 'provenance'),
  );
  const [text, setText] = useState(JSON.stringify(fields, null, 2));
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <div className="edit">
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
        rows={Math.min(18, text.split('\n').length + 1)}
        aria-label={`Edit ${item.ref}`}
        spellCheck={false}
      />
      {error === undefined ? null : <p className="error">{error}</p>}
      <button
        type="button"
        onClick={() => {
          try {
            const next = JSON.parse(text) as Record<string, unknown>;
            const set: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(next))
              if (JSON.stringify(v) !== JSON.stringify(fields[k])) set[k] = v;
            for (const k of Object.keys(fields)) if (!(k in next)) set[k] = null;
            if ('id' in set || 'provenance' in set)
              throw new Error('The id and provenance cannot be edited.');
            onSave(set);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        Save edit
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

/** View 2 — Review every extracted item with its provenance. */
export function Review() {
  const { server, task, refresh, notify, setView } = useStudio();
  const candidate = server?.candidate ?? null;
  const [ledger, setLedger] = useState<ReviewLedger>(
    server?.ledger ?? { version: 1, decisions: [] },
  );
  const [filter, setFilter] = useState<'all' | 'pending' | 'low' | 'assumed'>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (server?.ledger !== undefined) setLedger(server.ledger);
  }, [server?.ledger]);
  const items = useMemo(() => (candidate === null ? [] : itemsOf(candidate)), [candidate]);

  if (candidate === null) {
    return (
      <Section title="Review">
        <Empty>No candidate model yet. Upload documents and run the extraction in Sources.</Empty>
      </Section>
    );
  }
  const q = query.trim().toLowerCase();
  const visible = items.filter((i) => {
    const d = decisionOf(ledger, i);
    if (filter === 'pending' && d !== 'pending') return false;
    if (filter === 'low' && i.provenance.confidence !== 'low') return false;
    if (filter === 'assumed' && i.provenance.status !== 'assumed') return false;
    return (
      q === '' ||
      i.ref.includes(q) ||
      i.name.toLowerCase().includes(q) ||
      i.provenance.excerpt.toLowerCase().includes(q)
    );
  });
  const counts = { approve: 0, reject: 0, assume: 0, edit: 0, pending: 0 };
  for (const i of items) counts[decisionOf(ledger, i)]++;
  const set = (item: Item, d: Decision, fields?: Record<string, unknown>) => {
    setLedger((l) => decide(l, item, d, fields));
  };

  return (
    <Section
      title="Review"
      actions={
        <>
          <button
            type="button"
            onClick={() => {
              let l = ledger;
              for (const i of items)
                if (decisionOf(l, i) === 'pending') l = decide(l, i, 'approve');
              setLedger(l);
            }}
          >
            Approve all undecided
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              void task('review', async () => {
                const r = await api<{
                  ok: boolean;
                  modelVersion: number;
                  summary: {
                    approved: number;
                    rejected: number;
                    pending: string[];
                    cascaded: unknown[];
                  };
                  issues: { message: string }[];
                }>('POST', '/api/review', { ledger });
                await refresh();
                if (r.ok) {
                  notify({
                    kind: 'success',
                    text: `Saved: ${String(r.summary.approved)} approved, ${String(r.summary.rejected)} rejected, ${String(r.summary.pending.length)} left out. gamex/game-model.json is version ${String(r.modelVersion)}.`,
                  });
                  setView('parameters');
                } else {
                  notify({
                    kind: 'error',
                    text: `Decisions saved, but the model is not complete yet: ${r.issues[0]?.message ?? ''}`,
                  });
                }
              });
            }}
          >
            Save review
          </button>
        </>
      }
    >
      <p className="summary" aria-live="polite">
        {items.length} items · <Badge tone="ok">{counts.approve} approved</Badge>{' '}
        <Badge tone="warn">{counts.assume} assumed</Badge>{' '}
        <Badge tone="info">{counts.edit} edited</Badge>{' '}
        <Badge tone="bad">{counts.reject} rejected</Badge>{' '}
        <Badge tone="muted">{counts.pending} undecided</Badge>
      </p>
      <div className="form-row">
        <label>
          Show
          <select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value as typeof filter);
            }}
            aria-label="Filter items"
          >
            <option value="all">All items</option>
            <option value="pending">Undecided</option>
            <option value="low">Low confidence</option>
            <option value="assumed">Assumptions</option>
          </select>
        </label>
        <label>
          Search
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            placeholder="id, name or source text"
            aria-label="Search items"
          />
        </label>
      </div>
      {KINDS.map(([kind]) => {
        const group = visible.filter((i) => i.kind === kind);
        if (group.length === 0) return null;
        return (
          <details key={kind} open={group.length <= 25}>
            <summary>
              {kind} ({group.length})
            </summary>
            <ul className="review">
              {group.map((item) => {
                const d = decisionOf(ledger, item);
                const p = item.provenance;
                return (
                  <li
                    key={item.ref}
                    className={`review__item review__item--${d}`}
                    data-ref={item.ref}
                  >
                    <div className="review__head">
                      <code>{item.ref}</code> <strong>{item.name}</strong>{' '}
                      <Badge tone={TONE[d]}>{d}</Badge>
                      <Badge
                        tone={
                          p.confidence === 'high'
                            ? 'ok'
                            : p.confidence === 'medium'
                              ? 'warn'
                              : 'bad'
                        }
                      >
                        {p.confidence}
                      </Badge>
                      {p.status === 'assumed' ? <Badge tone="warn">assumption</Badge> : null}
                    </div>
                    <blockquote>
                      <span className="muted">
                        {p.source}
                        {p.location === '' ? '' : ` ${p.location}`}:
                      </span>{' '}
                      {p.excerpt}
                    </blockquote>
                    {p.alternatives === undefined ? null : (
                      <p className="warn">
                        Also stated:{' '}
                        {p.alternatives
                          .map((a) => `${String(a.value)} (${a.source} ${a.location})`)
                          .join(', ')}
                      </p>
                    )}
                    <div className="review__actions" role="group" aria-label={`Decide ${item.ref}`}>
                      <button
                        type="button"
                        aria-pressed={d === 'approve'}
                        onClick={() => {
                          set(item, 'approve');
                        }}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        aria-pressed={d === 'assume'}
                        onClick={() => {
                          set(item, 'assume');
                        }}
                      >
                        Assume
                      </button>
                      <button
                        type="button"
                        aria-pressed={d === 'edit'}
                        onClick={() => {
                          setEditing(item.ref);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        aria-pressed={d === 'reject'}
                        onClick={() => {
                          set(item, 'reject');
                        }}
                      >
                        Reject
                      </button>
                    </div>
                    {editing === item.ref ? (
                      <EditBox
                        item={item}
                        onCancel={() => {
                          setEditing(undefined);
                        }}
                        onSave={(fields) => {
                          set(item, 'edit', fields);
                          setEditing(undefined);
                        }}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}
    </Section>
  );
}
