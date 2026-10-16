import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Options } from 'tsup';
import { describe, expect, it } from 'vitest';
import tsupConfig from '../../tsup.config';

/**
 * La imagen de producción no lleva `tsx`: el alta de usuario tiene que salir COMPILADA junto a
 * la API. Con una lista de entradas (`['src/main.ts', 'scripts/crear-usuario.ts']`) tsup
 * calcula el directorio común y la salida pasaría a `dist/src/main.js`, rompiendo
 * `node dist/main.js`; con un objeto, el nombre de cada salida lo fija la clave.
 */
const paquete = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

describe('tsup: qué se compila', () => {
  // La configuración es un objeto (no una función ni una lista): se lee tal cual.
  const config = tsupConfig as Options;

  it('compila la API como dist/main.js y el alta de usuario como dist/crear-usuario.js', () => {
    expect(config.entry).toEqual({
      main: 'src/main.ts',
      'crear-usuario': 'scripts/crear-usuario.ts',
    });
  });

  it('`npm start` sigue arrancando dist/main.js', () => {
    expect(paquete.scripts.start).toBe('node dist/main.js');
  });

  it('en desarrollo, `npm run crear-usuario` sigue ejecutando el script con tsx', () => {
    expect(paquete.scripts['crear-usuario']).toBe('tsx scripts/crear-usuario.ts');
  });
});
