import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { gamex: 'src/bin.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: false,
  // Ship a single self-contained executable: bundle the workspace packages.
  noExternal: [/^@gamex\//],
  banner: { js: '#!/usr/bin/env node' },
});
