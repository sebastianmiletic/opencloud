import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true
  },
  build: {
    outDir: 'web-dist',
    emptyOutDir: true,
    sourcemap: true,
    target: ['es2020', 'safari13']
  }
});
