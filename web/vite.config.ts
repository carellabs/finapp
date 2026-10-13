import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// PWA sin `vite-plugin-pwa`: manifest y service worker estaticos en `public/`.
// El plugin arrastraba workbox-build -> ejs -> jake -> minimatch con una
// vulnerabilidad alta, a cambio de una funcionalidad (cache offline) que
// todavia no usamos. Se reevaluara cuando haga falta cache de verdad.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['tests/**/*.test.tsx', 'tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    coverage: { provider: 'v8', include: ['src/**/*.{ts,tsx}'], exclude: ['src/main.tsx'] },
  },
});
