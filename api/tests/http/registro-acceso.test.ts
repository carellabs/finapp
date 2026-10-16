import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { registrarAcceso } from '../../src/http/registro-acceso';
import type { EventoRegistro } from '../../src/infra/registro';

/**
 * Registro de acceso: UNA línea por petición, al terminar la respuesta, con el
 * método, la ruta SIN query string, el estado, la duración y el `request_id`.
 * Nunca el cuerpo ni las cabeceras.
 */

interface Par {
  readonly req: Request;
  readonly res: Response & EventEmitter;
}

function crearPar(
  url: string,
  opciones: {
    metodo?: string;
    requestId?: string;
    estado?: number;
    cabecerasEnviadas?: boolean;
  } = {},
): Par {
  const {
    metodo = 'GET',
    requestId = 'id-de-prueba',
    estado = 200,
    cabecerasEnviadas = false,
  } = opciones;
  const res = Object.assign(new EventEmitter(), {
    statusCode: estado,
    writableFinished: false,
    headersSent: cabecerasEnviadas,
    locals: requestId === '' ? {} : { requestId },
  }) as unknown as Response & EventEmitter;
  const req = { method: metodo, originalUrl: url } as unknown as Request;
  return { req, res };
}

/** Un reloj que devuelve estos instantes en orden. */
function reloj(...instantes: number[]): () => number {
  const pendientes = [...instantes];
  return () => {
    const siguiente = pendientes.shift();
    if (siguiente === undefined) throw new Error('el reloj se ha leído más veces de las previstas');
    return siguiente;
  };
}

function montar(par: Par, medirTiempo = reloj(0, 0)) {
  const eventos: EventoRegistro[] = [];
  const siguiente = vi.fn() as unknown as NextFunction;
  registrarAcceso({ registrar: (evento) => eventos.push(evento), medirTiempo })(
    par.req,
    par.res,
    siguiente,
  );
  return { eventos, siguiente };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('registrarAcceso', () => {
  it('sigue la cadena una vez y sin error, y no escribe nada hasta que la respuesta termina', () => {
    const par = crearPar('/api/v1/x');

    const { eventos, siguiente } = montar(par);

    expect(siguiente).toHaveBeenCalledTimes(1);
    expect(siguiente).toHaveBeenCalledWith();
    expect(eventos).toEqual([]);
  });

  it('al terminar escribe una línea con nivel, mensaje, request_id, método, ruta, estado y duración', () => {
    const par = crearPar('/api/v1/transacciones', {
      metodo: 'POST',
      requestId: 'id-1',
      estado: 201,
    });
    const { eventos } = montar(par, reloj(100, 142.6));

    par.res.emit('finish');

    expect(eventos).toStrictEqual([
      {
        nivel: 'info',
        mensaje: 'peticion',
        request_id: 'id-1',
        metodo: 'POST',
        ruta: '/api/v1/transacciones',
        estado: 201,
        // 142,6 - 100 = 42,6 ms, redondeado al milisegundo.
        duracion_ms: 43,
      },
    ]);
  });

  it('el estado es el que tiene la respuesta al terminar, no al empezar', () => {
    const par = crearPar('/x', { estado: 200 });
    const { eventos } = montar(par);

    par.res.statusCode = 503;
    par.res.emit('finish');

    expect(eventos[0]?.['estado']).toBe(503);
  });

  it('la ruta va sin query string: ni los filtros ni un token puesto en la URL llegan al log', () => {
    const par = crearPar('/api/v1/auth/reset?token=valor-privado&mes=2026-06');
    const { eventos } = montar(par);

    par.res.emit('finish');

    expect(eventos[0]?.['ruta']).toBe('/api/v1/auth/reset');
    expect(JSON.stringify(eventos)).not.toContain('valor-privado');
    expect(JSON.stringify(eventos)).not.toContain('2026-06');
  });

  it('una URL que acaba en ? tampoco deja el signo en la ruta', () => {
    const par = crearPar('/api/v1/x?');
    const { eventos } = montar(par);

    par.res.emit('finish');

    expect(eventos[0]?.['ruta']).toBe('/api/v1/x');
  });

  it('solo escribe una vez aunque la respuesta emita `finish` más veces', () => {
    const par = crearPar('/x');
    // Un reloj que nunca se agota: si hubiera un segundo registro, no fallaría en silencio.
    const { eventos } = montar(par, () => 0);

    par.res.emit('finish');
    par.res.emit('finish');

    expect(eventos).toHaveLength(1);
  });

  it('sin request_id en la respuesta, la línea no lo inventa', () => {
    const par = crearPar('/x', { requestId: '' });
    const { eventos } = montar(par);

    par.res.emit('finish');

    expect(eventos[0]).toBeDefined();
    expect(Object.keys(eventos[0] ?? {})).not.toContain('request_id');
  });

  it('un registrador que falla no rompe la respuesta ni tumba el proceso', () => {
    const par = crearPar('/x');
    const siguiente = vi.fn() as unknown as NextFunction;
    registrarAcceso({
      registrar: () => {
        throw new Error('stderr cerrado');
      },
      medirTiempo: reloj(0, 0),
    })(par.req, par.res, siguiente);

    expect(() => par.res.emit('finish')).not.toThrow();
  });

  it('por defecto escribe por el registro de la API: redactado y en una línea', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const par = crearPar('/api/v1/x', { requestId: 'id-por-defecto' });
    registrarAcceso()(par.req, par.res, vi.fn());

    par.res.emit('finish');

    expect(espia).toHaveBeenCalledTimes(1);
    const linea = JSON.parse(String(espia.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(linea).toMatchObject({
      nivel: 'info',
      mensaje: 'peticion',
      request_id: 'id-por-defecto',
      ruta: '/api/v1/x',
    });
  });
});

describe('registrarAcceso: la ruta es texto del cliente y se sanea', () => {
  it('la forma absoluta con credenciales no deja ni el usuario, ni la contraseña, ni el host', () => {
    const par = crearPar('http://user:PASS-SECRETA@host.example:8443/api/v1/x?q=1#frag');
    const { eventos } = montar(par);

    par.res.emit('finish');

    expect(eventos[0]?.['ruta']).toBe('/api/v1/x');
    const escrito = JSON.stringify(eventos);
    for (const fragmento of ['user', 'PASS-SECRETA', 'host.example', '8443', 'frag']) {
      expect(escrito).not.toContain(fragmento);
    }
  });

  it('un fragmento (#…) no llega al log', () => {
    const par = crearPar('/api/v1/x#valor-privado');
    const { eventos } = montar(par);

    par.res.emit('finish');

    expect(eventos[0]?.['ruta']).toBe('/api/v1/x');
  });

  it('un ? codificado (%3F) es parte de la ruta: no se corta ahí', () => {
    const par = crearPar('/api/v1/x%3Fparte');
    const { eventos } = montar(par);

    par.res.emit('finish');

    expect(eventos[0]?.['ruta']).toBe('/api/v1/x%3Fparte');
  });

  it('una URL de 15 KB se corta a 200 caracteres con la marca de truncado', () => {
    const par = crearPar(`/${'z'.repeat(15 * 1024)}`);
    const { eventos } = montar(par);

    par.res.emit('finish');

    const ruta = String(eventos[0]?.['ruta']);
    expect(ruta).toHaveLength(200 + '…[truncada]'.length);
    expect(ruta.endsWith('…[truncada]')).toBe(true);
    expect(JSON.stringify(eventos).length).toBeLessThan(600);
  });

  it('la ruta se calcula al empezar: no cambia si un router modifica req.url después', () => {
    const par = crearPar('/api/v1/transacciones/abc');
    const { eventos } = montar(par);

    (par.req as { originalUrl: string }).originalUrl = '/otra-cosa';
    par.res.emit('finish');

    expect(eventos[0]?.['ruta']).toBe('/api/v1/transacciones/abc');
  });
});

describe('registrarAcceso: /health no llena el log', () => {
  it.each([
    ['GET', '/health', 200],
    ['HEAD', '/health', 200],
    ['GET', '/health', 204],
    ['GET', '/health', 299],
    ['GET', '/health?comprobacion=1', 200],
    ['GET', 'http://host.example/health', 200],
  ])('%s %s con %i no deja línea', (metodo, url, estado) => {
    const par = crearPar(url, { metodo, estado });
    const { eventos } = montar(par);

    par.res.emit('finish');

    expect(eventos).toEqual([]);
  });

  it.each([
    ['GET', '/health', 500],
    ['GET', '/health', 503],
    ['HEAD', '/health', 500],
    ['GET', '/health', 199],
    ['GET', '/health', 300],
    ['GET', '/health', 404],
    ['POST', '/health', 200],
    ['PUT', '/health', 200],
    ['GET', '/healthz', 200],
    ['GET', '/health/otra', 200],
    ['GET', '/api/health', 200],
    ['GET', '/api/v1/health', 200],
  ])(
    '%s %s con %i SÍ deja línea (control: solo se calla el healthcheck que va bien)',
    (metodo, url, estado) => {
      const par = crearPar(url, { metodo, estado });
      const { eventos } = montar(par);

      par.res.emit('finish');

      expect(eventos).toHaveLength(1);
      expect(eventos[0]).toMatchObject({ metodo, estado });
    },
  );
});

describe('registrarAcceso: peticiones abortadas', () => {
  it('si la conexión se cierra sin terminar la respuesta, deja UNA línea con abortada: true', () => {
    const par = crearPar('/api/v1/transacciones', { metodo: 'GET', requestId: 'id-abortada' });
    const { eventos } = montar(par, reloj(10, 35));

    par.res.emit('close');

    expect(eventos).toStrictEqual([
      {
        nivel: 'info',
        mensaje: 'peticion',
        request_id: 'id-abortada',
        metodo: 'GET',
        ruta: '/api/v1/transacciones',
        abortada: true,
        duracion_ms: 25,
      },
    ]);
  });

  it('sin cabeceras enviadas no inventa un estado (el 200 por defecto de la respuesta no es lo que recibió nadie)', () => {
    const par = crearPar('/x', { estado: 200, cabecerasEnviadas: false });
    const { eventos } = montar(par);

    par.res.emit('close');

    expect(Object.keys(eventos[0] ?? {})).not.toContain('estado');
  });

  it('con las cabeceras ya enviadas, sí lleva el estado que se envió', () => {
    const par = crearPar('/x', { estado: 201, cabecerasEnviadas: true });
    const { eventos } = montar(par);

    par.res.emit('close');

    expect(eventos[0]).toMatchObject({ abortada: true, estado: 201 });
  });

  it('un /health abortado SÍ se registra: no es un healthcheck que fue bien', () => {
    const par = crearPar('/health', { estado: 200 });
    const { eventos } = montar(par);

    par.res.emit('close');

    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ abortada: true });
  });

  it('nunca dos líneas por petición: `finish` y luego `close` escriben una, sin abortada', () => {
    const par = crearPar('/x');
    const { eventos } = montar(par, () => 0);

    Object.assign(par.res, { writableFinished: true });
    par.res.emit('finish');
    par.res.emit('close');

    expect(eventos).toHaveLength(1);
    expect(Object.keys(eventos[0] ?? {})).not.toContain('abortada');
  });

  it('`close` repetido o `close` y luego `finish` tampoco duplican', () => {
    const par = crearPar('/x');
    const { eventos } = montar(par, () => 0);

    par.res.emit('close');
    par.res.emit('close');
    par.res.emit('finish');

    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ abortada: true });
  });

  it('un `close` con la respuesta ya terminada (writableFinished) no se toma por un aborto', () => {
    const par = crearPar('/x');
    const { eventos } = montar(par, () => 0);

    Object.assign(par.res, { writableFinished: true });
    par.res.emit('close');

    expect(eventos).toHaveLength(1);
    expect(Object.keys(eventos[0] ?? {})).not.toContain('abortada');
  });
});
