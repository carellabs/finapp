import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import express from 'express';
import { registrarAcceso } from '../../src/http/registro-acceso';
import { asignarRequestId } from '../../src/http/request-id';

/**
 * Una petición que el cliente corta antes de recibir la respuesta no emite `finish`, solo
 * `close`: sin escuchar también `close`, no dejaba ninguna línea. Con un servidor HTTP de
 * verdad, no con dobles: la semántica de `close` es la de Node.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let espia: MockInstance;
let servidor: http.Server;
let puerto: number;
let alLlegar: () => void;

function lineas(): Record<string, unknown>[] {
  return espia.mock.calls.map(
    (llamada) => JSON.parse(String(llamada[0])) as Record<string, unknown>,
  );
}

beforeEach(async () => {
  espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const app = express();
  app.use(asignarRequestId);
  app.use(registrarAcceso());
  // Nunca contesta: se queda esperando, como una consulta lenta a la base de datos.
  app.get('/lenta', () => {
    alLlegar();
  });
  app.get('/rapida', (_req, res) => {
    res.status(200).json({ ok: true });
  });
  servidor = http.createServer(app);
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  puerto = (servidor.address() as AddressInfo).port;
});

afterEach(async () => {
  servidor.closeAllConnections();
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
  vi.restoreAllMocks();
});

describe('petición abortada por el cliente (servidor HTTP real)', () => {
  it('deja UNA sola línea con abortada: true, el request_id y la ruta sin consulta, y sin estado', async () => {
    const llegada = new Promise<void>((resolve) => {
      alLlegar = resolve;
    });
    const peticion = http.get({ host: '127.0.0.1', port: puerto, path: '/lenta?secreto=valor' });
    peticion.on('error', () => undefined);
    await llegada;

    peticion.destroy();

    await vi.waitFor(() => {
      expect(lineas()).toHaveLength(1);
    });
    // Un margen para que una segunda línea (un `close` y un `finish` mal combinados) apareciera.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(lineas()).toHaveLength(1);
    expect(lineas()[0]).toMatchObject({
      nivel: 'info',
      mensaje: 'peticion',
      metodo: 'GET',
      ruta: '/lenta',
      abortada: true,
      request_id: expect.stringMatching(UUID) as unknown,
      duracion_ms: expect.any(Number) as unknown,
    });
    expect(Object.keys(lineas()[0] ?? {})).not.toContain('estado');
    expect(JSON.stringify(espia.mock.calls)).not.toContain('valor');
  });

  it('control: una petición normal en el mismo servidor deja UNA línea, con estado y sin abortada', async () => {
    await new Promise<void>((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port: puerto, path: '/rapida' }, (respuesta) => {
          respuesta.resume();
          respuesta.on('end', resolve);
        })
        .on('error', reject);
    });

    await vi.waitFor(() => {
      expect(lineas()).toHaveLength(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(lineas()).toHaveLength(1);
    expect(lineas()[0]).toMatchObject({ ruta: '/rapida', estado: 200 });
    expect(Object.keys(lineas()[0] ?? {})).not.toContain('abortada');
  });
});
