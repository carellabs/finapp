import { defineConfig } from 'vitest/config';

// Tests contra un Postgres real y efimero. Se lanzan con
// `npm run test:integration` desde la raiz, que levanta la base de datos.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    // Comparten una unica base de datos: en paralelo se pisarian entre si.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
