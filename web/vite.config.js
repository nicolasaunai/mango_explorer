import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  optimizeDeps: { exclude: ['pyodide'] },
  build: { target: 'es2022' },
});
