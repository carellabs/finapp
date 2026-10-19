import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Los de integracion necesitan una BD viva: van por `test:integration`.
    exclude: ['tests/integration/**'],
    // Margen frente a la saturacion de la maquina, NO para tests lentos (un test colgado sigue
    // fallando en segundos). Medido el 18-oct-2026 con 12 procesos de CPU en bucle (12 nucleos):
    // los tests de la primera peticion de supertest (`log-sin-fragmentos`, `ip-cliente`,
    // `limite-excedido`) pasan de 1,2-1,9 s libres a 3,3-4,7 s, hasta el 94 % del limite de 5 s,
    // y las propiedades de fast-check de `redaccion` de 2,4 s a 5-7 s. Los tests que lanzan
    // procesos llevan su timeout propio (TIMEOUT_TEST_PROCESO_MS). No subirlo sin medir antes en
    // maquina libre y bajo carga (skill testing-strategy, regla 8).
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        // Solo arranca el servidor: se cubre con los E2E, no aqui.
        'src/main.ts',
        // Tocan Postgres de verdad. Mockear el driver esta prohibido
        // (testing-strategy Hard Rule 3): se cubren con
        // `npm run test:integration` (72 tests). Excluirlos aqui no baja el
        // listón: solo evita exigir el mismo codigo cubierto dos veces con
        // dos varas distintas. La logica PURA que vive dentro de estos
        // ficheros (p.ej. `normalizar()` en transacciones.ts) igualmente
        // tiene su propio test unitario; solo no cuenta para el % del archivo.
        'src/auth/sesiones.ts',
        'src/auth/purga-sesiones.ts',
        'src/auth/usuarios.ts',
        'src/db/transaccion.ts',
        'src/auth/bloqueo.ts',
        'src/auth/middleware.ts',
        'src/http/rutas/**',
        'src/repositories/categorias.ts',
        'src/repositories/transacciones.ts',
        'src/repositories/presupuestos.ts',
        'src/repositories/prestamos.ts',
        'src/repositories/deudas.ts',
        'src/repositories/objetivos.ts',
        'src/repositories/configuracion.ts',
        'src/repositories/objetivo-historico.ts',
        'src/repositories/saldo-ahorro.ts',
        'src/usecases/**',
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
