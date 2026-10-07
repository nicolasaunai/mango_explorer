import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  base: './',
  plugins: [svelte()],
  resolve: {
    alias: { $spec: `${repoRoot}src/mango_explorer/spec`, $golden: `${repoRoot}golden` },
  },
  server: { fs: { allow: [repoRoot] } },
  build: { target: 'es2022' },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
