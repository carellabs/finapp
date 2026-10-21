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
  codigoDeSalida,
  crearDocker,
  crearDormir,
  crearLanzador,
  fueInterrumpido,
  MAX_BUFFER,
  numeroDeConsulta,
  STATUS_CTRL_C_WINDOWS,
} from './imagenes-soporte.mjs';
import { lanzar } from './procesos.mjs';

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

  it('en Windows un Ctrl-C no deja señal: el hijo sale con STATUS_CONTROL_C_EXIT (0xC000013A) y eso es una interrupción', () => {
    // Medido con un Ctrl-C real (GenerateConsoleCtrlEvent) sobre un hijo de spawnSync: status
    // 3221225786 y signal null. Sin esto el script daba por "fallo normal" un Ctrl-C.
    assert.equal(STATUS_CTRL_C_WINDOWS, 3221225786);
    assert.equal(fueInterrumpido({ status: STATUS_CTRL_C_WINDOWS, signal: null }), true);
    // Y su vecino no: es un código cualquiera.
    assert.equal(fueInterrumpido({ status: STATUS_CTRL_C_WINDOWS + 1, signal: null }), false);
    assert.equal(fueInterrumpido({ status: STATUS_CTRL_C_WINDOWS - 1, signal: null }), false);
  });
});

describe('codigoDeSalida', () => {
  it('SIGINT sale con 130 y SIGTERM con 143 (128 + el número de la señal)', () => {
    assert.equal(codigoDeSalida({ status: null, signal: 'SIGINT' }), 130);
    assert.equal(codigoDeSalida({ status: null, signal: 'SIGTERM' }), 143);
  });

  it('el Ctrl-C de Windows (sin señal) también sale con 130', () => {
    assert.equal(codigoDeSalida({ status: STATUS_CTRL_C_WINDOWS, signal: null }), 130);
  });

  it('cualquier otra señal, o ninguna, sale con 1', () => {
    for (const signal of ['SIGHUP', 'SIGKILL', 'SIGSEGV']) {
      assert.equal(codigoDeSalida({ status: null, signal }), 1, signal);
    }
    assert.equal(codigoDeSalida({ status: null, signal: null }), 1);
    assert.equal(codigoDeSalida({}), 1);
  });

  it('un error (ENOBUFS, ETIMEDOUT) sale con 1 aunque spawnSync haya matado al hijo con SIGTERM', () => {
    // spawnSync mata al hijo con `killSignal` (SIGTERM) al desbordar el buffer o agotar el
    // tiempo: el resultado trae signal 'SIGTERM' Y error. No es que a este script le hayan mandado
    // un SIGTERM: sale con 1, no con 143.
    for (const code of ['ENOBUFS', 'ETIMEDOUT']) {
      const error = Object.assign(new Error('x'), { code });
      assert.equal(codigoDeSalida({ status: null, signal: 'SIGTERM', error }), 1, code);
    }
  });
});

describe('crearLanzador', () => {
  /** Un `lanzar` falso que registra cada llamada y devuelve el resultado que se le dé. */
  const falso = (resultado) => {
    const llamadas = [];
    const lanzarFalso = (comando, argumentos, opciones) => {
      llamadas.push({ comando, argumentos, opciones });
      return resultado;
    };
    return { lanzarFalso, llamadas };
  };

  it('lanza el comando con los argumentos y un buffer grande, y devuelve el resultado', () => {
    const { lanzarFalso, llamadas } = falso({ status: 0, stdout: 'ok' });

    const resultado = crearLanzador(lanzarFalso, () => assert.fail('no debía interrumpir'))(
      'npm',
      ['run', 'x'],
      { stdio: 'inherit' },
    );

    assert.deepEqual(resultado, { status: 0, stdout: 'ok' });
    assert.equal(llamadas[0].comando, 'npm');
    assert.deepEqual(llamadas[0].argumentos, ['run', 'x']);
    assert.equal(llamadas[0].opciones.stdio, 'inherit');
    assert.equal(llamadas[0].opciones.maxBuffer, MAX_BUFFER);
  });

  it('las opciones del llamador mandan sobre las de por defecto', () => {
    const { lanzarFalso, llamadas } = falso({ status: 0 });

    crearLanzador(lanzarFalso, () => {})('node', [], { maxBuffer: 5 });

    assert.equal(llamadas[0].opciones.maxBuffer, 5);
  });

  it('un código de salida distinto de cero NO es una interrupción: se devuelve y decide quien llama', () => {
    const { lanzarFalso } = falso({ status: 3, stderr: 'no' });

    const resultado = crearLanzador(lanzarFalso, () => assert.fail('no debía interrumpir'))('npm', [
      'test',
    ]);

    assert.equal(resultado.status, 3);
  });

  it('un hijo muerto por una señal avisa UNA vez, con el resultado (para saber el código de salida) y la causa', () => {
    const resultadoDelHijo = { status: null, signal: 'SIGINT' };
    const { lanzarFalso } = falso(resultadoDelHijo);
    const avisos = [];

    crearLanzador(lanzarFalso, (mensaje, resultado) => avisos.push({ mensaje, resultado }))('npm', [
      'run',
      'migrate:up',
    ]);

    assert.equal(avisos.length, 1);
    assert.match(avisos[0].mensaje, /npm run/);
    assert.match(avisos[0].mensaje, /SIGINT/);
    assert.equal(avisos[0].resultado, resultadoDelHijo);
  });

  it('el Ctrl-C de Windows (sin señal) también avisa, y el mensaje dice que fue un Ctrl-C', () => {
    const { lanzarFalso } = falso({ status: STATUS_CTRL_C_WINDOWS, signal: null });
    const avisos = [];

    crearLanzador(lanzarFalso, (mensaje) => avisos.push(mensaje))('npm', ['run', 'x']);

    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /Ctrl-C/);
  });

  it('el mensaje no vuelca más que el comando y su primer argumento: los demás pueden llevar claves', () => {
    const { lanzarFalso } = falso({ status: null, signal: 'SIGTERM' });
    const avisos = [];

    crearLanzador(lanzarFalso, (mensaje) => avisos.push(mensaje))('docker', [
      'run',
      '--env',
      'POSTGRES_PASSWORD=clave-secreta-7731',
    ]);

    assert.match(avisos[0], /docker run/);
    assert.doesNotMatch(avisos[0], /clave-secreta-7731|POSTGRES_PASSWORD/);
  });

  it('`etiqueta` pone el nombre del paso en el mensaje y no llega a spawnSync', () => {
    const { lanzarFalso, llamadas } = falso({ status: null, signal: 'SIGINT' });
    const avisos = [];

    crearLanzador(lanzarFalso, (mensaje) => avisos.push(mensaje))('docker', ['exec'], {
      etiqueta: 'la espera a pg_isready',
    });

    assert.match(avisos[0], /la espera a pg_isready no termino/);
    assert.equal('etiqueta' in llamadas[0].opciones, false);
  });

  it('un buffer desbordado de verdad (ENOBUFS) avisa con un mensaje claro: ni SIGTERM ni un ENOBUFS sin tratar', () => {
    // Un hijo real que escribe 2 MiB: con el tope por defecto de spawnSync (1 MiB) muere con
    // ENOBUFS, y spawnSync lo mata con SIGTERM (el resultado trae signal Y error).
    const dosMiB = ['-e', "process.stdout.write('x'.repeat(2 * 1024 * 1024))"];
    const avisos = [];
    const lanzador = crearLanzador(lanzar, (mensaje, resultado) =>
      avisos.push({ mensaje, resultado }),
    );

    lanzador('node', dosMiB, { maxBuffer: 1024 * 1024 });

    assert.equal(avisos.length, 1);
    assert.match(avisos[0].mensaje, /ENOBUFS/);
    assert.match(avisos[0].mensaje, /buffer/i);
    assert.doesNotMatch(avisos[0].mensaje, /SIGTERM/);
    assert.equal(codigoDeSalida(avisos[0].resultado), 1);
  });

  it('con el tope por defecto del envoltorio esa misma salida de 2 MiB cabe y no avisa', () => {
    const dosMiB = ['-e', "process.stdout.write('x'.repeat(2 * 1024 * 1024))"];

    const resultado = crearLanzador(lanzar, () => assert.fail('no debía interrumpir'))(
      'node',
      dosMiB,
      { encoding: 'utf8' },
    );

    assert.equal(resultado.status, 0);
    assert.equal(resultado.stdout.length, 2 * 1024 * 1024);
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
