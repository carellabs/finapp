import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // `@finapp/shared` se publica como fuente TypeScript: se empaqueta aqui.
  noExternal: ['@finapp/shared'],
});
