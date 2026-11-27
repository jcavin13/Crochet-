/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

// base './' so the build works at any path (GitHub Pages project site); the app uses hash routing.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // registered from src/app/pwa.ts
      includeAssets: ['icon.svg', 'favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Crochet Tools',
        short_name: 'Crochet',
        description: 'Crochet notation editor, symbol charts, 3D shape preview and row counter. Works offline; patterns stay on your device.',
        lang: 'en',
        start_url: './#/',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f4efe4',
        theme_color: '#f4efe4',
        categories: ['lifestyle', 'productivity', 'utilities'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // app shell + all lazily loaded feature chunks (bundled patterns live inside the JS)
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json,wasm}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@spec': fileURLToPath(new URL('../spec', import.meta.url)),
    },
  },
  server: { fs: { allow: ['..'] } },
  // generous timeout: the sim tests are CPU-bound and run slowly on a loaded machine
  test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'], testTimeout: 60000 },
});
