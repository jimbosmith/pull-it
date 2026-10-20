import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist-bundle',
    emptyOutDir: true
  },
  server: {
    port: 5173
  }
});
