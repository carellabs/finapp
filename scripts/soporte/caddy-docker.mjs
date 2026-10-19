/**
 * Soporte de los tests que ejecutan Caddy en Docker (scripts/caddy.test.mjs e
 * scripts/imagen-web.test.mjs).
 *
 * Todo vive en una RED de Docker propia y con nombres unicos por ejecucion: una API falsa (un
 * servidor que devuelve lo que recibe), un contenedor que hace de `cloudflared` (para poder
 * originar peticiones desde una IP conocida) y el Caddy bajo prueba, publicado en un puerto
 * aleatorio de loopback. Nada toca la red ni los volumenes de compose del proyecto, ni 3000 ni
 * 5173. `limpiar()` lo borra todo, tambien si el proceso se interrumpe (`exit`, SIGINT y SIGTERM).
 *
 * Sin bind mounts: los ficheros entran con `docker cp`. Un bind mount de una ruta de Windows
 * llega vacio segun como este configurado Docker Desktop, y `docker cp` funciona igual en todas
 * partes.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lanzar } from '../procesos.mjs';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const leer = (rel) => readFileSync(join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');

/**
 * La imagen de Caddy tal como esta en docker/web.Dockerfile (version y digest): una sola
 * fuente de verdad, la que Dependabot sube. Si la sube, estos tests usan la nueva solos.
 * @returns {string}
 */
export function imagenCaddy() {
  const m = /^FROM (caddy:\S+@sha256:[0-9a-f]{64}) AS production$/m.exec(
    leer('docker/web.Dockerfile'),
  );
  if (m === null) throw new Error('docker/web.Dockerfile no declara la imagen de Caddy fijada');
  return m[1];
}

/**
 * La imagen de Node de docker/api.Dockerfile (fijada), para la API falsa y para `cloudflared`.
 * @returns {string}
 */
export function imagenNode() {
  const m = /^FROM (node:\S+@sha256:[0-9a-f]{64}) AS base$/m.exec(leer('docker/api.Dockerfile'));
  if (m === null) throw new Error('docker/api.Dockerfile no declara la imagen de Node fijada');
  return m[1];
}

/**
 * Ejecuta `docker` sin shell. No lanza si el comando falla: devuelve el resultado.
 * @param {string[]} argumentos
 * @param {import('node:child_process').SpawnSyncOptions} [opciones]
 */
export function docker(argumentos, opciones = {}) {
  return lanzar('docker', argumentos, { encoding: 'utf8', ...opciones });
}

/** Como `docker`, pero lanza si falla, y devuelve stdout sin el salto de linea final. */
export function dockerOk(argumentos, opciones = {}) {
  const r = docker(argumentos, opciones);
  if (r.status !== 0) {
    throw new Error(`docker ${argumentos.join(' ')} -> ${r.status}\n${r.stdout}${r.stderr}`);
  }
  return String(r.stdout).trim();
}

/** ¿Responde el demonio de Docker? */
export const dockerDisponible = () => docker(['info'], { stdio: 'ignore' }).status === 0;

/** Servidor HTTP que devuelve JSON con lo que ha recibido. Escucha en el 3000 del contenedor. */
const CODIGO_API_FALSA = `
import { createServer } from 'node:http';
createServer((req, res) => {
  const trozos = [];
  req.on('data', (t) => trozos.push(t));
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-Eco-Api', 'si');
    res.end(JSON.stringify({
      metodo: req.method,
      url: req.url,
      cabeceras: req.headers,
      remoto: req.socket.remoteAddress,
      cuerpo: Buffer.concat(trozos).toString(),
    }));
  });
}).listen(3000);
`;

/** Errores de un socket al que el otro extremo ha cortado la conexion mientras se escribia. */
const CODIGOS_CORTE = ['EPIPE', 'ECONNRESET'];

/**
 * Peticion HTTP sin dependencias. Devuelve estado, cabeceras (sin duplicar) y cuerpo.
 *
 * `toleraCorte`: para un cuerpo grande que el servidor puede rechazar antes de que acabe el envio
 * (Caddy responde 413 y cierra). Si la conexion se corta (`EPIPE`/`ECONNRESET`) DESPUES de recibir la
 * cabecera de la respuesta, se devuelve esa respuesta (con el cuerpo que llego; `cortada: true`) en
 * vez de rechazar. Sin respuesta no se puede saber el estado: rechaza con el error. Sin esta opcion,
 * cualquier error rechaza, como siempre.
 * @param {string} url
 * @param {{ metodo?: string, cabeceras?: Record<string, unknown>, cuerpo?: string, troceado?: boolean, toleraCorte?: boolean }} [opciones]
 */
export function pedir(
  url,
  { metodo = 'GET', cabeceras = {}, cuerpo, troceado = false, toleraCorte = false } = {},
) {
  return new Promise((listo, falla) => {
    // La respuesta, en cuanto llega su cabecera: lo que se devuelve si despues la conexion se corta.
    let hastaAhora = null;
    // `agent: false`: una conexion por peticion. Con keep-alive, tras un 413 que corta el cuerpo a medias,
    // la siguiente peticion reutilizaria un socket con restos de la anterior.
    // `troceado`: el cuerpo sale en trozos de 100 kB, sin Content-Length (Transfer-Encoding: chunked).
    const encabezados = troceado ? { ...cabeceras, 'Transfer-Encoding': 'chunked' } : cabeceras;
    const req = request(url, { method: metodo, headers: encabezados, agent: false }, (res) => {
      const trozos = [];
      const resumen = () => {
        // `rawHeaders` conserva las cabeceras repetidas (`headers` las funde con ", ").
        const lineas = [];
        for (let i = 0; i < res.rawHeaders.length; i += 2) {
          lineas.push([res.rawHeaders[i].toLowerCase(), res.rawHeaders[i + 1]]);
        }
        return {
          estado: res.statusCode,
          cabeceras: res.headers,
          lineas,
          cuerpo: Buffer.concat(trozos).toString('utf8'),
        };
      };
      hastaAhora = () => ({ ...resumen(), cortada: true });
      res.on('data', (t) => trozos.push(t));
      res.on('end', () => listo(resumen()));
    });
    req.on('error', (error) => {
      if (toleraCorte && hastaAhora !== null && CODIGOS_CORTE.includes(error.code)) {
        listo(hastaAhora());
      } else {
        falla(error);
      }
    });
    req.setTimeout(15_000, () => req.destroy(new Error(`tiempo agotado: ${url}`)));
    if (troceado && cuerpo !== undefined) {
      for (let i = 0; i < cuerpo.length; i += 100_000) req.write(cuerpo.slice(i, i + 100_000));
      req.end();
    } else {
      req.end(cuerpo);
    }
  });
}

/** Intentos por defecto de `pedirRechazable`. */
export const INTENTOS_CORTE = 5;

/**
 * Como `pedir`, para enviar un cuerpo grande a un servidor que puede rechazarlo y cortar antes de que
 * acabe el envio (Caddy con `request_body { max_size }`: 413 y cierre, RFC 9110 15.5.14).
 *
 * En el cliente, `EPIPE`/`ECONNRESET` llega a veces antes que la respuesta, y un RST puede llevarse la
 * respuesta sin leer: pasa casi siempre y falla segun una carrera. Por eso:
 *  - si la cabecera de la respuesta llego antes del corte, se devuelve esa respuesta;
 *  - si no llego, se reintenta la MISMA peticion, hasta `intentos` en total y SOLO ante
 *    `EPIPE`/`ECONNRESET`; agotados, lanza un error claro (con el ultimo como `cause`);
 *  - una respuesta, sea cual sea su estado, se devuelve tal cual (no se reintenta ni se oculta), y
 *    cualquier otro error (conexion rechazada, tiempo agotado...) lanza a la primera.
 * @param {string} url
 * @param {Parameters<typeof pedir>[1]} [opciones]
 * @param {{ intentos?: number }} [reintentos]
 */
export async function pedirRechazable(url, opciones = {}, { intentos = INTENTOS_CORTE } = {}) {
  let ultimo;
  for (let intento = 1; intento <= intentos; intento += 1) {
    try {
      return await pedir(url, { ...opciones, toleraCorte: true });
    } catch (error) {
      if (!CODIGOS_CORTE.includes(error.code)) throw error;
      ultimo = error;
    }
  }
  throw new Error(
    `${intentos} intentos de ${opciones.metodo ?? 'GET'} ${url} cortados (${ultimo.code}) sin recibir respuesta`,
    { cause: ultimo },
  );
}

/** Valores de una cabecera en las lineas crudas de la respuesta (una por cada aparicion). */
export const valoresDe = (respuesta, nombre) =>
  respuesta.lineas.filter(([n]) => n === nombre.toLowerCase()).map(([, v]) => v);

const dormir = (ms) => new Promise((listo) => setTimeout(listo, ms));

/**
 * Entorno de prueba: red + API falsa + `cloudflared` de mentira. Los Caddy se crean con
 * `arrancarCaddy`. Todo se destruye con `limpiar()`.
 */
export class EntornoCaddy {
  /**
   * @param {{ salir?: (codigo: number) => void }} [opciones] `salir` es lo que se llama tras limpiar
   *   cuando llega SIGINT o SIGTERM (por defecto `process.exit`); los tests lo sustituyen.
   */
  constructor({ salir = (codigo) => process.exit(codigo) } = {}) {
    this.sufijo = `${process.pid}-${randomBytes(3).toString('hex')}`;
    this.red = `finapp-test-14-${this.sufijo}`;
    this.contenedores = [];
    this.apiNombre = `${this.red}-api`;
    this.cloudflaredNombre = `${this.red}-cf`;
    this.cloudflaredIp = '';
    // `exit` solo no basta: Node no lo ejecuta si el proceso muere por una senal. Con un manejador
    // de SIGINT (Ctrl+C) y de SIGTERM se limpia y se sale con 128 + el numero de la senal.
    this.alSalir = () => this.limpiarSincrono();
    this.alSIGINT = () => {
      this.limpiarSincrono();
      salir(130);
    };
    this.alSIGTERM = () => {
      this.limpiarSincrono();
      salir(143);
    };
    process.on('exit', this.alSalir);
    process.on('SIGINT', this.alSIGINT);
    process.on('SIGTERM', this.alSIGTERM);
  }

  /** Quita los manejadores de proceso (los tests que crean un entorno y lo sueltan). */
  soltar() {
    process.off('exit', this.alSalir);
    process.off('SIGINT', this.alSIGINT);
    process.off('SIGTERM', this.alSIGTERM);
  }

  /** Crea la red, la API falsa y el `cloudflared` de mentira (y averigua su IP). */
  iniciar() {
    dockerOk(['network', 'create', this.red]);
    dockerOk([
      'run',
      '--detach',
      '--name',
      this.apiNombre,
      '--network',
      this.red,
      imagenNode(),
      'node',
      '--input-type=module',
      '-e',
      CODIGO_API_FALSA,
    ]);
    this.contenedores.push(this.apiNombre);
    dockerOk([
      'run',
      '--detach',
      '--name',
      this.cloudflaredNombre,
      '--network',
      this.red,
      imagenNode(),
      'sleep',
      '3600',
    ]);
    this.contenedores.push(this.cloudflaredNombre);
    this.cloudflaredIp = dockerOk([
      'inspect',
      '--format',
      `{{(index .NetworkSettings.Networks "${this.red}").IPAddress}}`,
      this.cloudflaredNombre,
    ]);
  }

  /**
   * Arranca un Caddy con la imagen dada.
   * @param {{
   *   imagen: string,
   *   entorno?: Record<string, string>,
   *   ficheros?: Array<{ origen: string, destino: string }>,  // `docker cp origen contenedor:destino`
   *   argumentos?: string[],   // opciones extra de `docker create` (--user, --read-only...)
   *   sufijoNombre?: string,
   * }} opciones
   * @returns {Promise<{ nombre: string, puerto: number, base: string }>}
   */
  async arrancarCaddy({
    imagen,
    entorno = {},
    ficheros = [],
    argumentos = [],
    sufijoNombre = 'caddy',
  }) {
    const nombre = `${this.red}-${sufijoNombre}`;
    const variables = Object.entries({
      API_UPSTREAM: `${this.apiNombre}:3000`,
      ...entorno,
    }).flatMap(([k, v]) => ['--env', `${k}=${v}`]);
    dockerOk([
      'create',
      '--name',
      nombre,
      '--network',
      this.red,
      // Puerto aleatorio de LOOPBACK: nunca el 3000 ni el 5173, ni expuesto a la red local.
      '--publish',
      '127.0.0.1::8080',
      ...variables,
      ...argumentos,
      imagen,
    ]);
    this.contenedores.push(nombre);
    for (const { origen, destino } of ficheros) {
      dockerOk(['cp', origen, `${nombre}:${destino}`]);
    }
    dockerOk(['start', nombre]);

    const publicado = dockerOk(['port', nombre, '8080/tcp']).split('\n')[0];
    const puerto = Number(publicado.slice(publicado.lastIndexOf(':') + 1));
    const base = `http://127.0.0.1:${puerto}`;
    await this.esperar(nombre, base);
    return { nombre, puerto, base };
  }

  /** Espera a que Caddy responda; si el contenedor muere, lanza con sus logs. */
  async esperar(nombre, base) {
    for (let intento = 0; intento < 80; intento += 1) {
      try {
        const r = await pedir(`${base}/`);
        if (r.estado > 0) return;
      } catch {
        // aun no escucha
      }
      const estado = dockerOk(['inspect', '--format', '{{.State.Running}}', nombre]);
      if (estado !== 'true') {
        throw new Error(`Caddy (${nombre}) se ha parado:\n${this.logs(nombre)}`);
      }
      await dormir(250);
    }
    throw new Error(`Caddy (${nombre}) no responde:\n${this.logs(nombre)}`);
  }

  /** Espera a que la API falsa conteste a traves del Caddy dado. */
  async esperarApi(base) {
    for (let intento = 0; intento < 80; intento += 1) {
      const r = await pedir(`${base}/api/v1/listo`).catch(() => ({ estado: 0 }));
      if (r.estado === 200) return;
      await dormir(250);
    }
    throw new Error(`La API falsa no responde:\n${this.logs(this.apiNombre)}`);
  }

  logs(nombre) {
    const r = docker(['logs', nombre]);
    return `${r.stdout}${r.stderr}`;
  }

  /**
   * Hace una peticion DESDE el contenedor `cloudflared` de mentira: el Caddy ve su IP como el
   * extremo de la conexion. Devuelve el JSON que imprime el script (estado y cuerpo).
   */
  desdeCloudflared(url, cabeceras = {}) {
    const codigo = `
      const r = await fetch(${JSON.stringify(url)}, { headers: ${JSON.stringify(cabeceras)} });
      console.log(JSON.stringify({ estado: r.status, cuerpo: await r.text() }));
    `;
    const salida = dockerOk([
      'exec',
      this.cloudflaredNombre,
      'node',
      '--input-type=module',
      '-e',
      codigo,
    ]);
    return JSON.parse(salida);
  }

  /** Borra contenedores y red. Idempotente. */
  limpiarSincrono() {
    while (this.contenedores.length > 0) {
      docker(['rm', '--force', '--volumes', this.contenedores.pop()], { stdio: 'ignore' });
    }
    docker(['network', 'rm', this.red], { stdio: 'ignore' });
  }

  limpiar() {
    this.limpiarSincrono();
  }
}

/**
 * Directivas de una CSP: `{ 'default-src': ["'self'"], ... }`.
 * @param {string} valor
 */
export function parsearCsp(valor) {
  const directivas = {};
  for (const trozo of valor.split(';')) {
    const [nombre, ...fuentes] = trozo.trim().split(/\s+/);
    if (nombre !== '') directivas[nombre] = fuentes;
  }
  return directivas;
}
