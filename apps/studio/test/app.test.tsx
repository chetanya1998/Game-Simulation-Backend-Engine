import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import { nextPreference, resolveTheme } from '../src/theme.ts';

describe('theme', () => {
  it('follows the system setting by default and honours explicit choices', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('cycles system → light → dark → system', () => {
    expect(nextPreference('system')).toBe('light');
    expect(nextPreference('light')).toBe('dark');
    expect(nextPreference('dark')).toBe('system');
  });
});

describe('App', () => {
  it('renders the studio shell in the resolved theme', () => {
    const html = renderToString(<App systemPrefersDark />);
    expect(html).toContain('GameX Engine Studio');
    expect(html).toContain('data-theme="dark"');
  });
});
