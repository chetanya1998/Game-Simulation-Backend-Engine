import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs: the static build works from any folder or file server.
  base: './',
  worker: { format: 'es' },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 4000 },
});
