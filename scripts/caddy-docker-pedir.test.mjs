/**
 * Tests de `pedirRechazable` (scripts/soporte/caddy-docker.mjs), el cliente de prueba para un
 * cuerpo grande que el servidor puede rechazar ANTES de que el cliente termine de enviarlo.
 *
 * Caddy (`request_body { max_size 1MB }`) responde 413 y cierra la conexion sin esperar a los
 * 2 MB que el cliente aun esta escribiendo (RFC 9110, 15.5.14). En el cliente, `write EPIPE` o
 * `ECONNRESET` puede llegar antes de que se procese la respuesta, y un RST puede llevarse la
 * respuesta sin leer: pasa casi siempre, y falla segun una carrera. Aqui la carrera se hace
 * DETERMINISTA con un servidor TCP falso que simula a Caddy, sin Docker.
 */
import assert from 'node:assert/strict';
import net from 'node:net';
import { describe, it } from 'node:test';
import { INTENTOS_CORTE, pedir, pedirRechazable } from './soporte/caddy-docker.mjs';

const CABECERA_413 = 'HTTP/1.1 413 Payload Too Large\r\nConnection: close\r\nX-Caddy: si\r\n';
const GRANDE = 'x'.repeat(2_000_000);
// Por si un bucle de reintentos se desbocara (la mutacion «N sin tope»): el test muere, no se cuelga.
const TIMEOUT = { timeout: 20_000 };

/**
 * Servidor TCP que se comporta segun `comportamiento(n)`, con `n` el numero de conexion (1, 2...):
 *  - `reset`: lee el primer trozo y resetea la conexion SIN responder.
 *  - `parcial`: responde la cabecera de un 413 con cuerpo anunciado y resetea sin enviarlo.
 *  - `completa`: lee TODO el cuerpo y responde un 413 normal.
 *  - `ok200`: lee TODO el cuerpo y responde 200.
 */
async function servidorFalso(comportamiento) {
  const conexiones = [];
  const servidor = net.createServer((socket) => {
    const n = conexiones.push(socket);
    const que = comportamiento(n);
    socket.on('error', () => {});
    if (que === 'reset') {
      socket.once('data', () => socket.resetAndDestroy());
    } else if (que === 'parcial') {
      socket.once('data', () => {
        socket.write(`${CABECERA_413}Content-Length: 100\r\n\r\n`, () =>
          setTimeout(() => socket.resetAndDestroy(), 30),
        );
      });
    } else {
      // El cliente HTTP no cierra su lado al acabar de enviar: se responde cuando ha llegado el cuerpo entero.
      let recibido = 0;
      socket.on('data', (trozo) => {
        recibido += trozo.length;
        if (recibido < GRANDE.length) return;
        const linea = que === 'ok200' ? 'HTTP/1.1 200 OK\r\n' : CABECERA_413;
        socket.end(`${linea}Content-Length: 0\r\n\r\n`);
      });
    }
  });
  await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
  return {
    url: `http://127.0.0.1:${servidor.address().port}/api/v1/transacciones`,
    /** Conexiones aceptadas hasta ahora. */
    conexiones: () => conexiones.length,
    cerrar: () =>
      new Promise((listo) => {
        for (const s of conexiones) s.destroy();
        servidor.close(listo);
      }),
  };
}

/** Ejecuta `fn` con un servidor falso y lo cierra siempre. */
async function conServidor(comportamiento, fn) {
  const servidor = await servidorFalso(comportamiento);
  try {
    return await fn(servidor);
  } finally {
    await servidor.cerrar();
  }
}

const peticion = {
  metodo: 'POST',
  cabeceras: { 'Content-Type': 'application/json' },
  cuerpo: GRANDE,
};

describe('pedir: el comportamiento de siempre, sin tolerar nada', () => {
  it(
    'un corte de la conexion mientras envia rechaza con el error del socket',
    TIMEOUT,
    async () => {
      await conServidor(
        () => 'reset',
        async ({ url }) => {
          await assert.rejects(pedir(url, peticion), (e) =>
            ['EPIPE', 'ECONNRESET'].includes(e.code),
          );
        },
      );
    },
  );

  it(
    'con la cabecera ya recibida y un corte despues, tambien rechaza (solo lo tolera quien lo pide)',
    TIMEOUT,
    async () => {
      await conServidor(
        () => 'parcial',
        async ({ url }) => {
          await assert.rejects(pedir(url, peticion), (e) => e.code === 'ECONNRESET');
        },
      );
    },
  );
});

describe('pedirRechazable: un servidor que rechaza el cuerpo y corta antes de que acabe el envio', () => {
  it(
    'si la cabecera del 413 llego antes del corte, devuelve ese 413 sin reintentar',
    TIMEOUT,
    async () => {
      await conServidor(
        () => 'parcial',
        async (servidor) => {
          const r = await pedirRechazable(servidor.url, peticion);

          assert.equal(r.estado, 413);
          assert.equal(r.cabeceras['x-caddy'], 'si');
          assert.equal(servidor.conexiones(), 1, 'reintento teniendo ya la respuesta');
        },
      );
    },
  );

  it('tambien con el cuerpo troceado (Transfer-Encoding: chunked)', TIMEOUT, async () => {
    await conServidor(
      () => 'parcial',
      async (servidor) => {
        const r = await pedirRechazable(servidor.url, { ...peticion, troceado: true });

        assert.equal(r.estado, 413);
      },
    );
  });

  it(
    'si el corte llega SIN respuesta, reintenta y devuelve el 413 del primer intento que la recibe',
    TIMEOUT,
    async () => {
      await conServidor(
        (n) => (n < 3 ? 'reset' : 'completa'),
        async (servidor) => {
          const r = await pedirRechazable(servidor.url, peticion);

          assert.equal(r.estado, 413);
          assert.equal(servidor.conexiones(), 3);
        },
      );
    },
  );

  it(
    'si ningun intento recibe respuesta, FALLA con un mensaje claro tras `intentos` intentos',
    TIMEOUT,
    async () => {
      await conServidor(
        () => 'reset',
        async (servidor) => {
          await assert.rejects(pedirRechazable(servidor.url, peticion, { intentos: 3 }), (e) => {
            assert.match(e.message, /3 intentos/);
            assert.match(e.message, /sin recibir respuesta/);
            assert.ok(['EPIPE', 'ECONNRESET'].includes(e.cause?.code), 'perdio el error original');
            return true;
          });
          assert.equal(servidor.conexiones(), 3, 'ni uno mas ni uno menos que `intentos`');
        },
      );
    },
  );

  it('por defecto son INTENTOS_CORTE intentos (más de uno, con tope)', TIMEOUT, async () => {
    await conServidor(
      () => 'reset',
      async (servidor) => {
        await assert.rejects(pedirRechazable(servidor.url, peticion), /intentos/);
        assert.equal(servidor.conexiones(), INTENTOS_CORTE);
        assert.ok(INTENTOS_CORTE > 1 && INTENTOS_CORTE <= 10, `${INTENTOS_CORTE} intentos`);
      },
    );
  });

  it(
    'una respuesta que NO es 413 se devuelve tal cual: no se reintenta ni se oculta',
    TIMEOUT,
    async () => {
      await conServidor(
        () => 'ok200',
        async (servidor) => {
          const r = await pedirRechazable(servidor.url, peticion);

          assert.equal(r.estado, 200);
          assert.equal(servidor.conexiones(), 1);
        },
      );
    },
  );

  it('un 413 completo (sin corte) se devuelve a la primera', TIMEOUT, async () => {
    await conServidor(
      () => 'completa',
      async (servidor) => {
        const r = await pedirRechazable(servidor.url, peticion);

        assert.equal(r.estado, 413);
        assert.equal(servidor.conexiones(), 1);
      },
    );
  });

  it(
    'un error que no es un corte durante el envio (conexion rechazada) NO se reintenta',
    TIMEOUT,
    async () => {
      // Un puerto en el que no escucha nadie: se abre un servidor, se anota el puerto y se cierra.
      const servidor = await servidorFalso(() => 'reset');
      const url = servidor.url;
      await servidor.cerrar();

      await assert.rejects(pedirRechazable(url, peticion), (e) => {
        assert.equal(e.code, 'ECONNREFUSED');
        assert.doesNotMatch(e.message, /intentos/);
        return true;
      });
    },
  );
});
