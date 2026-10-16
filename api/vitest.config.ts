import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Los de integracion necesitan una BD viva: van por `test:integration`.
    exclude: ['tests/integration/**'],
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
