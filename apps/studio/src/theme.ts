export type ThemePreference = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

/** Resolves the effective theme: an explicit choice wins, otherwise follow the OS setting. */
export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): Theme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

export function nextPreference(preference: ThemePreference): ThemePreference {
  const order: readonly ThemePreference[] = ['system', 'light', 'dark'];
  return order[(order.indexOf(preference) + 1) % order.length] ?? 'system';
}
