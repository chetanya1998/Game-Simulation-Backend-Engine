import { useEffect, useState } from 'react';
import { ENGINE_VERSION } from '@gamex/engine';
import { SCHEMA_VERSION } from '@gamex/model';
import { readToken, setToken } from './lib/api.ts';
import { useStudio, type ViewId } from './store.ts';
import { nextPreference, resolveTheme, type ThemePreference } from './theme.ts';
import { Compare } from './views/Compare.tsx';
import { EconomyGraph, EntityMap, StateMachine } from './views/Graphs.tsx';
import { Outcomes } from './views/Outcomes.tsx';
import { Parameters } from './views/Parameters.tsx';
import { Review } from './views/Review.tsx';
import { Scenario } from './views/Scenario.tsx';
import { Sources } from './views/Sources.tsx';
import { SpecPack } from './views/SpecPack.tsx';

export const VIEWS: readonly { id: ViewId; label: string; server?: boolean }[] = [
  { id: 'sources', label: 'Sources' },
  { id: 'review', label: 'Review', server: true },
  { id: 'entities', label: 'Entity map' },
  { id: 'economy', label: 'Economy' },
  { id: 'states', label: 'State machine' },
  { id: 'parameters', label: 'Parameters' },
  { id: 'scenario', label: 'Scenario' },
  { id: 'outcomes', label: 'Outcomes' },
  { id: 'compare', label: 'Compare A/B' },
  { id: 'specpack', label: 'Spec Pack' },
];

const PANES: Record<ViewId, () => React.JSX.Element> = {
  sources: Sources,
  review: Review,
  entities: EntityMap,
  economy: EconomyGraph,
  states: StateMachine,
  parameters: Parameters,
  scenario: Scenario,
  outcomes: Outcomes,
  compare: Compare,
  specpack: SpecPack,
};

const THEME_KEY = 'gamex-studio-theme';

function storedTheme(): ThemePreference {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export interface AppProps {
  systemPrefersDark?: boolean;
  /** Skip talking to the server (tests). */
  boot?: boolean;
}

export function App({ systemPrefersDark = false, boot = true }: AppProps) {
  const { mode, view, setView, theme, setTheme, notice, notify, busy, server, model } = useStudio();
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);
  const resolved = resolveTheme(theme, prefersDark);

  useEffect(() => {
    if (!boot) return;
    setTheme(storedTheme());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      setPrefersDark(e.matches);
    };
    mq.addEventListener('change', onChange);
    const token = readToken();
    if (token !== undefined) {
      setToken(token);
      useStudio.setState({ mode: 'server' });
      void useStudio
        .getState()
        .task('load', () => useStudio.getState().refresh())
        .then(() => {
          const s = useStudio.getState();
          if (s.server?.model != null) setView('parameters');
          else if (s.server?.candidate != null) setView('review');
        });
    }
    return () => {
      mq.removeEventListener('change', onChange);
    };
  }, [boot, setTheme, setView]);

  useEffect(() => {
    document.documentElement.dataset['theme'] = resolved;
  }, [resolved]);

  const Pane = PANES[view];
  return (
    <div className="app" data-theme={resolved}>
      <header className="app__header">
        <h1>
          GameX Engine Studio <span className="muted">{model?.meta.name ?? ''}</span>
        </h1>
        <div className="app__meta">
          <span className={`badge badge--${mode === 'server' ? 'ok' : 'info'}`} data-testid="mode">
            {mode === 'server' ? `local server · ${server?.repo ?? ''}` : 'static · offline'}
          </span>
          <button
            type="button"
            aria-label={`Theme: ${theme}`}
            onClick={() => {
              const next = nextPreference(theme);
              setTheme(next);
              try {
                localStorage.setItem(THEME_KEY, next);
              } catch {
                // per-viewer convenience only
              }
            }}
          >
            Theme: {theme}
          </button>
        </div>
      </header>
      <div className="app__body">
        <nav className="nav" aria-label="Views">
          <ol>
            {VIEWS.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  className={view === v.id ? 'on' : ''}
                  aria-current={view === v.id ? 'page' : undefined}
                  disabled={v.server === true && mode !== 'server'}
                  onClick={() => {
                    setView(v.id);
                  }}
                >
                  {v.label}
                </button>
              </li>
            ))}
          </ol>
          <p className="nav__foot muted">
            schema {SCHEMA_VERSION} · engine {ENGINE_VERSION}
          </p>
        </nav>
        <main className="main">
          {notice === undefined ? null : (
            <div
              className={`notice notice--${notice.kind}`}
              role={notice.kind === 'error' ? 'alert' : 'status'}
            >
              {notice.text}
              <button
                type="button"
                className="link"
                aria-label="Dismiss"
                onClick={() => {
                  notify(undefined);
                }}
              >
                ×
              </button>
            </div>
          )}
          {busy === undefined ? null : (
            <div className="busy" role="status" data-testid="busy">
              Working: {busy}…
            </div>
          )}
          <Pane />
        </main>
      </div>
    </div>
  );
}
