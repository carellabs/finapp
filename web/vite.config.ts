import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { proxyDeLaApi } from './vite.proxy.ts';

// PWA sin `vite-plugin-pwa`: manifest y service worker estaticos en `public/`.
// El plugin arrastraba workbox-build -> ejs -> jake -> minimatch con una
// vulnerabilidad alta, a cambio de una funcionalidad (cache offline) que
// todavia no usamos. Se reevaluara cuando haga falta cache de verdad.
//
// Un solo origen: en desarrollo, `/api` se reenvia a la API (API_PROXY_TARGET) para que el
// navegador solo hable con este servidor, como en produccion (docker/Caddyfile).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true, proxy: proxyDeLaApi(process.env.API_PROXY_TARGET) },
  // Nada inlinado como `data:`: la CSP de produccion (docker/Caddyfile) solo admite el propio
  // origen, y un icono o una fuente pequenos (Vite inlina por defecto lo de menos de 4 KiB)
  // quedarian bloqueados solo en produccion.
  build: { assetsInlineLimit: 0 },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['tests/**/*.test.tsx', 'tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    coverage: { provider: 'v8', include: ['src/**/*.{ts,tsx}'], exclude: ['src/main.tsx'] },
  },
});
