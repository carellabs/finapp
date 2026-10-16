/**
 * Tests de scripts/imagenes-soporte.mjs: las piezas de scripts/verificar-imagenes.mjs que deciden
 * si un resultado de Docker o de psql vale. Son las que, mal hechas, dan un verde falso:
 *  - `Number('')` es 0: una consulta que falla (sin salida) pasaba por "hay 0 usuarios".
 *  - Un proceso matado por una señal (Ctrl-C, un tiempo agotado) o desbordado devuelve `status`
 *    null: no es un fallo ordinario y el script tiene que limpiar y parar, no seguir.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  crearDocker,
  crearDormir,
  fueInterrumpido,
  MAX_BUFFER,
  numeroDeConsulta,
} from './imagenes-soporte.mjs';

describe('numeroDeConsulta', () => {
  it('lee el número de una consulta que salió bien (con su salto de línea)', () => {
    assert.equal(numeroDeConsulta({ status: 0, stdout: '11\n', stderr: '' }, 'tablas'), 11);
    assert.equal(numeroDeConsulta({ status: 0, stdout: '0\n', stderr: '' }, 'usuarios'), 0);
    assert.equal(numeroDeConsulta({ status: 0, stdout: '  42  ', stderr: '' }, 'x'), 42);
  });

  it('una consulta que falló NO es un 0, aunque no tenga salida', () => {
    // Era el hueco: `Number('')` es 0 y `contar(...) === 0` pasaba con psql roto.
    assert.throws(
      () => numeroDeConsulta({ status: 2, stdout: '', stderr: 'psql: error' }, 'usuarios'),
      /usuarios.*fall/,
    );
    assert.throws(
      () => numeroDeConsulta({ status: 1, stdout: '5\n', stderr: 'ERROR' }, 'usuarios'),
      /usuarios.*fall/,
    );
  });

  it('una salida vacía con estado 0 tampoco es un 0', () => {
    assert.throws(
      () => numeroDeConsulta({ status: 0, stdout: '', stderr: '' }, 'usuarios'),
      /usuarios.*numero/i,
    );
    assert.throws(
      () => numeroDeConsulta({ status: 0, stdout: '\n', stderr: '' }, 'usuarios'),
      /usuarios.*numero/i,
    );
  });

  it('una salida que no es un entero (texto, decimales, negativos, varias líneas) se rechaza', () => {
    for (const salida of ['f\n', '1.5\n', '-1\n', 'NaN\n', '1\n2\n', '0x10\n', '1e3\n']) {
      assert.throws(
        () => numeroDeConsulta({ status: 0, stdout: salida, stderr: '' }, 'x'),
        /numero/i,
        JSON.stringify(salida),
      );
    }
  });

  it('un resultado interrumpido (señal, buffer desbordado) se rechaza, aunque traiga salida', () => {
    assert.throws(
      () => numeroDeConsulta({ status: null, signal: 'SIGINT', stdout: '3\n', stderr: '' }, 'x'),
      /interrump/i,
    );
    assert.throws(
      () =>
        numeroDeConsulta(
          {
            status: null,
            error: Object.assign(new Error('x'), { code: 'ENOBUFS' }),
            stdout: '3\n',
          },
          'x',
        ),
      /interrump/i,
    );
  });

  it('el mensaje de error no vuelca la salida de psql (puede llevar datos)', () => {
    assert.throws(
      () => numeroDeConsulta({ status: 0, stdout: 'dato-sensible-9913\n', stderr: '' }, 'usuarios'),
      (error) => !error.message.includes('dato-sensible-9913'),
    );
  });
});

describe('fueInterrumpido', () => {
  it('un proceso que termina con un código (cero o no) no está interrumpido', () => {
    assert.equal(fueInterrumpido({ status: 0 }), false);
    assert.equal(fueInterrumpido({ status: 1 }), false);
    assert.equal(fueInterrumpido({ status: 130 }), false);
  });

  it('la señal que lo mató, o un estado nulo, sí', () => {
    assert.equal(fueInterrumpido({ status: null, signal: 'SIGINT' }), true);
    assert.equal(fueInterrumpido({ status: null, signal: null }), true);
    assert.equal(fueInterrumpido({ status: 0, signal: 'SIGTERM' }), true);
  });

  it('sin estado, sin señal y sin error no se sabe qué pasó: tampoco es un éxito', () => {
    assert.equal(fueInterrumpido({}), true);
    assert.equal(fueInterrumpido({ stdout: 'algo' }), true);
  });

  it('un error con un estado numérico también cuenta (el error manda)', () => {
    assert.equal(
      fueInterrumpido({ status: 0, error: Object.assign(new Error('x'), { code: 'EPERM' }) }),
      true,
    );
  });

  it('un error al lanzar o de buffer (ENOBUFS, ETIMEDOUT, ENOENT) también', () => {
    for (const code of ['ENOBUFS', 'ETIMEDOUT', 'ENOENT']) {
      assert.equal(
        fueInterrumpido({ status: null, error: Object.assign(new Error('x'), { code }) }),
        true,
        code,
      );
    }
  });
});

describe('crearDocker', () => {
  /** Un `lanzar` falso que registra cada llamada y devuelve el resultado que se le dé. */
  const falso = (resultado) => {
    const llamadas = [];
    const lanzar = (comando, argumentos, opciones) => {
      llamadas.push({ comando, argumentos, opciones });
      return resultado;
    };
    return { lanzar, llamadas };
  };

  it('lanza `docker` con los argumentos, en texto y con un buffer grande (node-pg-migrate es muy verboso)', () => {
    const { lanzar, llamadas } = falso({ status: 0, stdout: 'ok' });
    const alInterrumpir = () => assert.fail('no debía interrumpir');

    const resultado = crearDocker(lanzar, alInterrumpir)(['run', '--rm', 'imagen']);

    assert.deepEqual(resultado, { status: 0, stdout: 'ok' });
    assert.equal(llamadas[0].comando, 'docker');
    assert.deepEqual(llamadas[0].argumentos, ['run', '--rm', 'imagen']);
    assert.equal(llamadas[0].opciones.encoding, 'utf8');
    assert.equal(llamadas[0].opciones.maxBuffer, MAX_BUFFER);
    assert.ok(MAX_BUFFER >= 64 * 1024 * 1024);
  });

  it('las opciones del llamador mandan sobre las de por defecto', () => {
    const { lanzar, llamadas } = falso({ status: 0 });

    crearDocker(lanzar, () => {})(['info'], { stdio: 'ignore', maxBuffer: 5 });

    assert.equal(llamadas[0].opciones.stdio, 'ignore');
    assert.equal(llamadas[0].opciones.maxBuffer, 5);
    assert.equal(llamadas[0].opciones.encoding, 'utf8');
  });

  it('si Docker falla con un código normal devuelve el resultado: decide quien llama', () => {
    const { lanzar } = falso({ status: 1, stderr: 'no' });
    const alInterrumpir = () => assert.fail('un código de salida no es una interrupción');

    assert.equal(crearDocker(lanzar, alInterrumpir)(['info']).status, 1);
  });

  it('si Docker muere por una señal, avisa (para limpiar y salir) y dice cuál', () => {
    const { lanzar } = falso({ status: null, signal: 'SIGINT' });
    const avisos = [];

    crearDocker(lanzar, (mensaje) => avisos.push(mensaje))(['build', '--target', 'migrate']);

    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /docker build/);
    assert.match(avisos[0], /SIGINT/);
  });

  it('si el buffer se desborda, avisa y dice el código del error', () => {
    const error = Object.assign(new Error('maxBuffer exceeded'), { code: 'ENOBUFS' });
    const { lanzar } = falso({ status: null, error });
    const avisos = [];

    crearDocker(lanzar, (mensaje) => avisos.push(mensaje))(['run', 'imagen']);

    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /ENOBUFS/);
  });
});

describe('crearDormir', () => {
  it('espera con un proceso de node (sin shell) los milisegundos pedidos', () => {
    const llamadas = [];
    const lanzar = (comando, argumentos, opciones) => {
      llamadas.push({ comando, argumentos, opciones });
      return { status: 0 };
    };

    crearDormir(lanzar, () => assert.fail('no debía interrumpir'))(500);

    assert.equal(llamadas[0].comando, 'node');
    assert.match(llamadas[0].argumentos.join(' '), /setTimeout.*500/);
    assert.equal(llamadas[0].opciones.stdio, 'ignore');
  });

  it('si la espera la corta una señal (Ctrl-C), avisa en vez de seguir como si nada', () => {
    const lanzar = () => ({ status: null, signal: 'SIGINT' });
    const avisos = [];

    crearDormir(lanzar, (mensaje) => avisos.push(mensaje))(500);

    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /SIGINT/);
  });
});
