import { cpSync, existsSync, rmSync } from 'node:fs';
import { defineConfig } from 'tsup';

const studio = new URL('../../apps/studio/dist/', import.meta.url).pathname;
const target = new URL('./dist/studio/', import.meta.url).pathname;

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
  // `gamex studio` serves the built studio from dist/studio (turbo builds @gamex/studio first).
  onSuccess: () => {
    if (!existsSync(`${studio}index.html`)) throw new Error('apps/studio is not built; run `pnpm build`.');
    rmSync(target, { recursive: true, force: true });
    cpSync(studio, target, { recursive: true });
    return Promise.resolve();
  },
});
