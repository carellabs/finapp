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
    // Margen frente a la saturacion de la maquina (varias sesiones, lint y tests a la vez), NO
    // para tests lentos: un test colgado sigue fallando en segundos. Medido el 18-oct-2026 con 36
    // procesos de CPU en bucle (12 nucleos): con los valores por defecto (5 s / 10 s) fallaban 4
    // de 130 tests en 3 de 3 pasadas (jsdom + userEvent, 5,6-8,9 s cada uno); con 12 bucles, 0-6
    // fallos segun la pasada. Con la maquina libre el mas lento tarda 1,6 s. No subirlos sin
    // medir antes en maquina libre y bajo carga (skill testing-strategy, regla 8).
    // Respaldado por la medida: sin el, con 36 bucles de CPU fallan 4 tests por `Test timed out in
    // 5000ms`. No se sube `hookTimeout`: quitarlo no cambio nada medido.
    testTimeout: 15_000,
    // 16 ficheros jsdom a la vez (por defecto, nucleos - 1 = 11 aqui) saturan la maquina: con
    // 12 bucles vitest dejo de arrancar workers ("Timeout waiting for worker", 60 s fijos en
    // vitest) y terminaron 6 de 16 ficheros; con 4 workers, 130 de 130 en las mismas condiciones.
    // Visto 1 vez de 4 pasadas por defecto con 12 bucles y no se repitio con 36: es una
    // proteccion, no una cura medida. Libre cuesta ~3 s (14 s frente a 11 s). En GitHub
    // (ubuntu-latest, 4 vCPU) vitest usa 3 workers: 4 no cambia nada alli.
    maxWorkers: 4,
    include: ['tests/**/*.test.tsx', 'tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    coverage: { provider: 'v8', include: ['src/**/*.{ts,tsx}'], exclude: ['src/main.tsx'] },
  },
});
