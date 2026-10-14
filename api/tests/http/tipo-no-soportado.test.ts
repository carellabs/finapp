import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { crearApp } from '../../src/app';
import { cargarEnv } from '../../src/config/env';
import { crearPool } from '../../src/db/cliente';
import { ORIGEN_FRONTEND_PRUEBAS } from '../soporte/origen';

/**
 * Regresión: con una codificación (`Content-Encoding`) o un juego de caracteres
 * que el lector del cuerpo no soporta, Express responde 415, y el manejador de
 * errores lo dejaba salir como `ERROR_INTERNO`: el código de un fallo del
 * servidor para un error del cliente.
 */
const DATABASE_URL = 'postgresql://usuario:clave@db:5432/finapp';

let app: Express;

beforeAll(() => {
  const env = cargarEnv({
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL,
    ORIGEN_FRONTEND: ORIGEN_FRONTEND_PRUEBAS,
  });
  app = crearApp(env, crearPool(DATABASE_URL), {
    limitePorMinutoGlobal: 100_000,
    limitePorVentanaLogin: 100_000,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('415: cuerpo con una codificación o un juego de caracteres no soportado', () => {
  it.each<readonly [string, Readonly<Record<string, string>>]>([
    ['Content-Encoding desconocido', { 'Content-Encoding': 'codificacion-distintiva' }],
    ['charset desconocido', { 'Content-Type': 'application/json; charset=juego-distintivo' }],
  ])(
    '%s: responde 415 con TIPO_NO_SOPORTADO, no con ERROR_INTERNO',
    async (_descripcion, cabeceras) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const peticion = request(app)
        .post('/api/v1/transacciones')
        .set('Origin', ORIGEN_FRONTEND_PRUEBAS)
        .set('Content-Type', 'application/json');
      for (const [nombre, valor] of Object.entries(cabeceras)) peticion.set(nombre, valor);

      const respuesta = await peticion.send('{}');

      expect(respuesta.status).toBe(415);
      const cuerpo = respuesta.body as { error: { codigo: string; mensaje: string } };
      expect(cuerpo.error.codigo).toBe('TIPO_NO_SOPORTADO');
      // Lo recibido no se devuelve: el detalle de body-parser va solo al log.
      expect(JSON.stringify(respuesta.body)).not.toContain('distintiv');
    },
  );
});
