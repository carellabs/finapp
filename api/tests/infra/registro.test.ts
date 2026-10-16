import { afterEach, describe, expect, it, vi } from 'vitest';
import { REDACTADO } from '../../src/infra/redaccion';
import { causaDeError, registrarEnConsola, type EventoRegistro } from '../../src/infra/registro';

/**
 * Cómo se describe un error en el log sin volcar datos: el tipo y, si lo hay, el
 * código (SQLSTATE de Postgres, errno de Node). Jamás el mensaje, que puede
 * llevar un importe, un nombre o el valor de una clave duplicada.
 */
describe('causaDeError', () => {
  it('un Error lleva su tipo', () => {
    expect(causaDeError(new TypeError('x'))).toEqual({ error: 'TypeError' });
  });

  it('con un código de texto lo añade (SQLSTATE o errno)', () => {
    const error = Object.assign(new Error('x'), { code: '57P01' });

    expect(causaDeError(error)).toEqual({ error: 'Error', codigo: '57P01' });
  });

  it('un código que no es texto se ignora', () => {
    const error = Object.assign(new Error('x'), { code: 42 });

    expect(causaDeError(error)).toEqual({ error: 'Error' });
  });

  it('lo que no es un Error no aporta nada (no se vuelca su valor)', () => {
    expect(causaDeError('dato-sensible')).toEqual({});
    expect(causaDeError({ code: '57P01', message: 'dato-sensible' })).toEqual({});
    expect(causaDeError(null)).toEqual({});
    expect(causaDeError(undefined)).toEqual({});
  });

  it('nunca incluye el mensaje', () => {
    const error = Object.assign(new Error('Key (nombre)=(Ana García) already exists'), {
      code: '23505',
    });

    const texto = JSON.stringify(causaDeError(error));

    expect(texto).not.toContain('Ana');
    expect(texto).not.toContain('already exists');
  });
});

/**
 * `registrarEnConsola` es el ÚNICO sitio que escribe en el log (un `no-console`
 * de ESLint lo impone en `src/`). La redacción vive aquí, así que nada de lo que
 * se registra depende de que quien llama se acuerde de ella.
 */
describe('registrarEnConsola', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function capturar(evento: unknown): string[] {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    registrarEnConsola(evento as EventoRegistro);
    return espia.mock.calls.map((llamada) => String(llamada[0]));
  }

  it('escribe una sola línea de JSON con el evento tal cual', () => {
    const lineas = capturar({ nivel: 'info', mensaje: 'api escuchando', puerto: 3000 });

    expect(lineas).toHaveLength(1);
    expect(JSON.parse(lineas[0] ?? '')).toEqual({
      nivel: 'info',
      mensaje: 'api escuchando',
      puerto: 3000,
    });
  });

  it('redacta una contraseña, una cookie y una autorización aunque se hayan colado en el evento', () => {
    const lineas = capturar({
      nivel: 'info',
      mensaje: 'x',
      password: 'valor-privado-1',
      Cookie: 'sid=valor-privado-2',
      authorization: 'Bearer valor-privado-3',
    });

    expect(lineas).toHaveLength(1);
    expect(lineas[0]).not.toContain('valor-privado');
    expect(JSON.parse(lineas[0] ?? '')).toMatchObject({
      password: REDACTADO,
      Cookie: REDACTADO,
      authorization: REDACTADO,
      mensaje: 'x',
    });
  });

  it('redacta a cualquier profundidad: un volcado de la petición no filtra las cabeceras', () => {
    const lineas = capturar({
      nivel: 'error',
      mensaje: 'volcado',
      req: {
        headers: {
          cookie: 'sid=valor-privado-1',
          'set-cookie': ['sid=valor-privado-2'],
          'proxy-authorization': 'Basic valor-privado-3',
          host: 'api.example',
        },
        body: { nombreUsuario: 'ana', password: 'valor-privado-4' },
      },
    });

    expect(lineas[0]).not.toContain('valor-privado');
    expect(lineas[0]).toContain('api.example');
  });

  it('el contrato de Registrar admite el evento de una tarea (nombre y contadores)', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Sin `as`: si el tipo de `EventoRegistro` dejara de admitirlo, esto no compila.
    registrarEnConsola({
      nivel: 'info',
      mensaje: 'x',
      tarea: 'foto-mensual-objetivos',
      creadas: 3,
    });

    expect(JSON.parse(String(espia.mock.calls[0]?.[0]))).toMatchObject({
      tarea: 'foto-mensual-objetivos',
      creadas: 3,
    });
  });

  it('no redacta de más: los campos de una tarea (nombre y contadores) salen tal cual', () => {
    const lineas = capturar({
      nivel: 'info',
      mensaje: 'fotos mensuales de objetivos generadas',
      tarea: 'foto-mensual-objetivos',
      creadas: 3,
      borradas: 7,
      plazo_ms: 8000,
    });

    expect(JSON.parse(lineas[0] ?? '')).toEqual({
      nivel: 'info',
      mensaje: 'fotos mensuales de objetivos generadas',
      tarea: 'foto-mensual-objetivos',
      creadas: 3,
      borradas: 7,
      plazo_ms: 8000,
    });
  });

  it('un salto de línea en un valor no crea otra línea del log', () => {
    const lineas = capturar({
      nivel: 'warn',
      mensaje: 'x\n{"nivel":"info","mensaje":"falso"}',
    });

    expect(lineas).toHaveLength(1);
    expect(lineas[0]).not.toMatch(/[\r\n]/);
  });
});
