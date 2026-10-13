import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { crearApp } from '../src/app';
import { cargarEnv } from '../src/config/env';
import { crearPool } from '../src/db/cliente';

const ENV_VALIDO = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://usuario:clave@db:5432/finapp',
  ORIGEN_FRONTEND: 'http://localhost:5173',
} satisfies NodeJS.ProcessEnv;

describe('cargarEnv', () => {
  it('acepta una configuracion completa', () => {
    expect(cargarEnv(ENV_VALIDO).PORT).toBe(3000);
  });

  it('falla ruidosamente si falta DATABASE_URL, en lugar de arrancar a medias', () => {
    const { DATABASE_URL: _omitida, ...incompleto } = ENV_VALIDO;
    expect(() => cargarEnv(incompleto)).toThrow(/DATABASE_URL/);
  });

  it('el mensaje de error nombra la variable pero NUNCA su valor', () => {
    expect(() => cargarEnv({ ...ENV_VALIDO, PORT: '99999' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('clave') as unknown }),
    );
  });
});

describe('aplicacion HTTP', () => {
  let app: Express;

  beforeAll(() => {
    // El pool no se conecta hasta la primera query: /health y el 404 no la tocan.
    app = crearApp(cargarEnv(ENV_VALIDO), crearPool(ENV_VALIDO.DATABASE_URL));
  });

  it('GET /health devuelve 200 y nada mas que el estado', async () => {
    const respuesta = await request(app).get('/health');

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toEqual({ estado: 'ok' });
  });

  it('GET /health no filtra version, dependencias ni rutas internas', async () => {
    const cuerpo = JSON.stringify((await request(app).get('/health')).body);

    for (const filtracion of ['version', 'node', 'postgres', 'database', '/app', 'C:\\']) {
      expect(cuerpo.toLowerCase()).not.toContain(filtracion.toLowerCase());
    }
  });

  it('oculta la cabecera x-powered-by y aplica las de helmet', async () => {
    const respuesta = await request(app).get('/health');

    expect(respuesta.headers['x-powered-by']).toBeUndefined();
    expect(respuesta.headers['x-content-type-options']).toBe('nosniff');
  });

  it('una ruta inexistente devuelve 404 generico sin eco de la ruta', async () => {
    const respuesta = await request(app).get('/api/v1/secretos/../../etc/passwd');

    expect(respuesta.status).toBe(404);
    expect(respuesta.body).toEqual({
      error: { codigo: 'NO_ENCONTRADO', mensaje: 'Recurso no encontrado' },
    });
  });

  it('rechaza un cuerpo sobredimensionado con 413 y sin stack trace', async () => {
    const enorme = { relleno: 'x'.repeat(200_000) };
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const respuesta = await request(app).post('/cualquiera').send(enorme);

    espia.mockRestore();
    const cuerpo = respuesta.body as { error: { codigo: string } };

    expect(respuesta.status).toBe(413);
    expect(cuerpo.error.codigo).toBe('PAYLOAD_DEMASIADO_GRANDE');
    expect(JSON.stringify(cuerpo)).not.toMatch(/at |\.ts:|node_modules/);
  });
});
