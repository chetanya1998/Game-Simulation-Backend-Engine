import { useState } from 'react';
import { ENGINE_VERSION } from '@gamex/engine';
import { SCHEMA_VERSION } from '@gamex/model';
import { nextPreference, resolveTheme, type ThemePreference } from './theme.ts';

export interface AppProps {
  systemPrefersDark?: boolean;
  initialPreference?: ThemePreference;
}

export function App({ systemPrefersDark = false, initialPreference = 'system' }: AppProps) {
  const [preference, setPreference] = useState<ThemePreference>(initialPreference);
  const theme = resolveTheme(preference, systemPrefersDark);
  return (
    <div className="app" data-theme={theme}>
      <header className="app__header">
        <h1>GameX Engine Studio</h1>
        <button
          type="button"
          onClick={() => {
            setPreference(nextPreference(preference));
          }}
        >
          Theme: {preference}
        </button>
      </header>
      <main>
        <p>
          Game Model schema {SCHEMA_VERSION} · engine {ENGINE_VERSION}
        </p>
        <p>Views (upload, review, simulation, Spec Pack) arrive in Phase 5.</p>
      </main>
    </div>
  );
}
