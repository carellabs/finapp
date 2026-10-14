import { performance } from 'node:perf_hooks';
import type { RequestHandler } from 'express';
import { registrarEnConsola, type Registrar } from '../infra/registro';
import { leerRequestId } from './request-id';
import { rutaDePeticion } from './ruta';

export interface OpcionesRegistroAcceso {
  /** Por defecto, el registro de la API (`registrarEnConsola`). */
  readonly registrar?: Registrar;
  /** Milisegundos desde un origen cualquiera. Por defecto, `performance.now`. */
  readonly medirTiempo?: () => number;
}

/**
 * El healthcheck de Docker (`wget --spider`, cada 10 s) llega por aquí: miles de líneas al
 * día que no dicen nada. Solo se calla el que va bien (GET/HEAD con 2xx); un `/health` que
 * falla, o abortado, sí se registra.
 */
const RUTA_DE_SALUD = '/health';
const METODOS_DE_SALUD: ReadonlySet<string> = new Set(['GET', 'HEAD']);

function esSaludCorrecta(metodo: string, ruta: string, estado: number): boolean {
  return METODOS_DE_SALUD.has(metodo) && ruta === RUTA_DE_SALUD && estado >= 200 && estado < 300;
}

/**
 * Registro de acceso: UNA línea por petición, cuando la respuesta termina, con `request_id`,
 * método, ruta (sin esquema, autoridad, consulta ni fragmento, y con tope: ver
 * `rutaDePeticion`), estado y duración en ms.
 *
 * Nunca el cuerpo ni las cabeceras: ahí viajan la contraseña del login y la cookie de
 * sesión. Lleva el `request_id` que ya asignó `asignarRequestId`, que tiene que ir antes
 * en la cadena; si no hay, la línea sale sin el campo en vez de inventarlo.
 *
 * Si el cliente corta la conexión antes de recibir la respuesta (`close` sin `finish`), la
 * línea sale igualmente, con `abortada: true`, y solo con el estado si las cabeceras ya se
 * habían enviado: el 200 por defecto de una respuesta sin enviar no lo recibió nadie. Nunca
 * dos líneas por petición.
 *
 * No lleva marca de tiempo: la pone el driver `json-file` de Docker (`docker compose logs -t`).
 */
export function registrarAcceso(opciones: OpcionesRegistroAcceso = {}): RequestHandler {
  const { registrar = registrarEnConsola, medirTiempo = () => performance.now() } = opciones;

  return (req, res, next) => {
    const inicio = medirTiempo();
    const requestId = leerRequestId(res);
    // Al empezar: un router que reescribe `req.url` por debajo no cambia lo que se registra.
    const ruta = rutaDePeticion(req.originalUrl);
    let escrita = false;

    function escribir(abortada: boolean): void {
      if (escrita) return;
      escrita = true;
      if (!abortada && esSaludCorrecta(req.method, ruta, res.statusCode)) return;

      // Un registro roto (stderr cerrado…) no puede convertirse en una excepción no
      // capturada dentro de un evento: tumbaría el proceso por una línea de log.
      try {
        registrar({
          nivel: 'info',
          mensaje: 'peticion',
          ...(requestId === undefined ? {} : { request_id: requestId }),
          metodo: req.method,
          ruta,
          ...(abortada ? { abortada: true } : {}),
          ...(abortada && !res.headersSent ? {} : { estado: res.statusCode }),
          duracion_ms: Math.round(medirTiempo() - inicio),
        });
      } catch {
        // Nada más que hacer: la línea se pierde, la respuesta ya se envió.
      }
    }

    // `close` llega SIEMPRE, también tras `finish`: la primera de las dos escribe y la otra
    // no. Si `close` llega sin que la respuesta haya terminado, el cliente se fue.
    res.once('finish', () => {
      escribir(false);
    });
    res.once('close', () => {
      escribir(!res.writableFinished);
    });

    next();
  };
}
