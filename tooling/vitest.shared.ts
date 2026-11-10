import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const packagesDir = fileURLToPath(new URL('../packages/', import.meta.url));

/**
 * Tests import workspace packages from source (no build step needed).
 * Builds and type-checks resolve them through package.json "exports" → dist.
 */
const alias = Object.fromEntries(
  readdirSync(packagesDir).map((name) => [`@gamex/${name}`, `${packagesDir}${name}/src/index.ts`]),
);

export interface SharedOptions {
  /** Minimum coverage (lines, branches, functions, statements) enforced for this package. */
  coverageThreshold?: number;
  environment?: 'node' | 'jsdom';
}

export function sharedConfig(options: SharedOptions = {}) {
  const t = options.coverageThreshold ?? 0;
  return defineConfig({
    resolve: { alias },
    test: {
      include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
      environment: options.environment ?? 'node',
      coverage: {
        provider: 'v8',
        include: ['src/**'],
        reporter: ['text-summary'],
        thresholds: { lines: t, branches: t, functions: t, statements: t },
      },
    },
  });
}
