import { defineConfig } from 'tsup';

export default defineConfig({
  // Objeto, no lista: la clave fija el nombre de la salida (`dist/main.js`, que arranca la
  // imagen). Con una lista tsup saca el directorio comun de las entradas y la API pasaria a
  // `dist/src/main.js`. `crear-usuario` va compilado porque la imagen de produccion no lleva
  // `tsx`: el alta del usuario en el servidor es `node dist/crear-usuario.js`.
  entry: { main: 'src/main.ts', 'crear-usuario': 'scripts/crear-usuario.ts' },
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // `@finapp/shared` se publica como fuente TypeScript: se empaqueta aqui.
  noExternal: ['@finapp/shared'],
});
