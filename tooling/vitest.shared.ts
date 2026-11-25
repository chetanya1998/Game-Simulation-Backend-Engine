import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const packagesDir = fileURLToPath(new URL('../packages/', import.meta.url));

/**
 * Tests import workspace packages from source (no build step needed).
 * Builds and type-checks resolve them through package.json "exports" → dist.
 */
const alias = readdirSync(packagesDir).flatMap((name) => [
  { find: new RegExp(`^@gamex/${name}$`), replacement: `${packagesDir}${name}/src/index.ts` },
  // Subpath exports such as @gamex/specpack/node → src/node/index.ts.
  {
    find: new RegExp(`^@gamex/${name}/(.+)$`),
    replacement: `${packagesDir}${name}/src/$1/index.ts`,
  },
]);

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
      // Simulation and search tests take seconds; under turbo every package runs at once.
      testTimeout: 30_000,
      coverage: {
        provider: 'v8',
        include: ['src/**'],
        reporter: ['text-summary'],
        thresholds: { lines: t, branches: t, functions: t, statements: t },
      },
    },
  });
}
