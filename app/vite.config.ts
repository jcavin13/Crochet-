/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// base './' so the build works at any path (GitHub Pages project site); the app uses hash routing.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@spec': fileURLToPath(new URL('../spec', import.meta.url)),
    },
  },
  server: { fs: { allow: ['..'] } },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
