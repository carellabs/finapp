import { describe, expect, it } from 'vitest';
import request from 'supertest';
import express, { type Request } from 'express';
import { cargarEnv } from '../../src/config/env';
import { crearClaveCliente } from '../../src/http/ip-cliente';

describe('crearClaveCliente: sin IP determinable', () => {
  it('cae en una clave fija en vez de undefined, para que el límite siga aplicándose', () => {
    const generarClave = crearClaveCliente({ detrasDeProxy: false });
    // Express deja `req.ip` en undefined si el socket se destruyó antes de leerlo.
    const sinIp = {
      ip: undefined,
      get: () => undefined,
      socket: { remoteAddress: undefined },
      app: { get: () => () => false },
    } as unknown as Request;

    expect(generarClave(sinIp)).toBe('sin-ip');
  });
});

describe('crearClaveCliente: contrato con el ajuste `trust proxy` de Express', () => {
  // `cargarEnv` solo deja pasar listas de saltos, pero el contrato del selector
  // es el de Express: el salto inmediato es el índice 0 de la cadena de confianza.
  // Con un número de saltos (que la configuración de la API no admite) esa
  // semántica se ve sin ambigüedad: 1 salto = el inmediato.
  it('trata el salto inmediato como el índice 0 de la cadena de confianza', async () => {
    const generarClave = crearClaveCliente({ detrasDeProxy: false });
    const app = express();
    app.set('trust proxy', 1);
    app.get('/clave', (req, res) => {
      res.json({ clave: generarClave(req) });
    });

    const respuesta = await request(app).get('/clave').set('CF-Connecting-IP', '203.0.113.5');

    expect(respuesta.body).toEqual({ clave: '203.0.113.5' });
  });
});

describe('crearClaveCliente: socket IPv4 mapeado a IPv6 (Node con doble pila)', () => {
  // En producción Node escucha en doble pila, y la IPv4 de Caddy llega al
  // socket como `::ffff:172.30.0.2`. Debe contar como su IPv4 frente a
  // `TRUST_PROXY=172.30.0.0/24`. Se usa la función de confianza REAL que Express
  // compila a partir de lo que devuelve `cargarEnv`.
  const trustProxy = cargarEnv({
    NODE_ENV: 'production',
    PORT: '3000',
    DATABASE_URL: 'postgresql://usuario:clave@db:5432/finapp',
    ORIGEN_FRONTEND: 'https://finanzas.example.com',
    TRUST_PROXY: '172.30.0.0/24',
  }).TRUST_PROXY;
  const generarClave = crearClaveCliente({ detrasDeProxy: true, registrar: () => undefined });

  function peticionDesdeSocket(direccion: string): Request {
    const app = express();
    app.set('trust proxy', trustProxy);
    return {
      app,
      ip: '198.51.100.9', // lo que habría salido de req.ip si el salto no fuera de confianza
      socket: { remoteAddress: direccion },
      get: () => '203.0.113.5', // CF-Connecting-IP
    } as unknown as Request;
  }

  it.each(['172.30.0.2', '::ffff:172.30.0.2', '::ffff:ac1e:2'])(
    'el socket %s es de confianza y se lee CF-Connecting-IP',
    (socket) => {
      expect(generarClave(peticionDesdeSocket(socket))).toBe('203.0.113.5');
    },
  );

  it.each(['172.31.0.2', '::ffff:172.31.0.2', '127.0.0.1', '::1', '203.0.113.9'])(
    'control: el socket %s queda fuera de la subred y se ignora la cabecera',
    (socket) => {
      expect(generarClave(peticionDesdeSocket(socket))).toBe('198.51.100.9');
    },
  );
});
