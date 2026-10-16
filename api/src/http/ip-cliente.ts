import { isIP } from 'node:net';
import type { Request } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import { registrarEnConsola } from '../infra/registro';
import { leerRequestId } from './request-id';

/**
 * Clave de los limitadores: la IP real del cliente detrás de Cloudflare.
 *
 * Topología de producción: cliente -> borde de Cloudflare -> `cloudflared`
 * (túnel) -> Caddy interno -> API, todos en una red Docker interna sin puertos
 * publicados. Para la API, el salto inmediato es Caddy; `req.ip` sería la IP
 * de `cloudflared` en TODAS las peticiones y los limitadores se comportarían
 * como un único contador global. Cloudflare sí pone la IP del cliente en
 * `CF-Connecting-IP`, y Caddy la deja pasar si la petición viene de `cloudflared`
 * (`reverse_proxy` reescribe las `X-Forwarded-*`, no el resto de cabeceras).
 *
 * CONDICIÓN DE SEGURIDAD: `CF-Connecting-IP` solo es fiable si el origen NO es
 * accesible salvo a través del túnel. Cualquiera que llegue al origen por otro
 * camino escribe la cabecera él mismo y elige su propia clave: rotar la
 * cabecera le daría un contador nuevo en cada petición. Por eso aquí solo se
 * lee cuando el salto inmediato está en `TRUST_PROXY`, y esa lista debe ser
 * la red interna (la ausencia de puertos publicados se comprueba desde fuera
 * en la fase 6; este código es la segunda barrera, no la primera).
 *
 * ALCANCE DE ESA SEGUNDA BARRERA: solo protege el acceso DIRECTO a la API. No
 * protege a Caddy. Si Caddy fuera alcanzable por otro camino que no sea el túnel
 * (un puerto publicado, otra red Docker), quien llegara por ahí escribiría la
 * cabecera y la API la daría por buena, porque Caddy sí está en `TRUST_PROXY`.
 * Por eso Caddy descarta `CF-Connecting-IP` cuando su `remote_ip` no es
 * `cloudflared`: lo hace `docker/Caddyfile` (variable `CLOUDFLARED_IP`) y lo
 * prueba `scripts/caddy.test.mjs`.
 */

/** Cabecera con la IP del cliente que añade el borde de Cloudflare. */
const CABECERA_IP_CLIENTE = 'CF-Connecting-IP';

/**
 * Las direcciones IPv6 de una misma persona viven en una subred: sin agrupar,
 * rotar dentro de su /64 le daría 2^64 contadores. 56 es el valor por defecto
 * de `express-rate-limit` 8 para su propio generador (agrupa también los /64).
 */
const PREFIJO_IPV6 = 56;

/** Clave de reserva si Express no puede determinar la IP: el límite se sigue aplicando. */
const CLAVE_SIN_IP = 'sin-ip';

/** Por qué la clave ha caído en `req.ip` en lugar de `CF-Connecting-IP`. */
export type MotivoRespaldo = 'salto_no_confiable' | 'cabecera_ausente' | 'cabecera_invalida';

export interface OpcionesClaveCliente {
  /**
   * La app está configurada detrás de un proxy (`TRUST_PROXY` no es `false`).
   * Solo entonces volver a `req.ip` es una anomalía que merece registro; sin
   * proxy (desarrollo) es lo normal y registrarlo sería ruido en cada petición.
   */
  readonly detrasDeProxy: boolean;
  /**
   * Registro del respaldo, con el id de la petición si ya lo tiene. Por defecto, una línea
   * JSON en stderr, sin ninguna IP.
   */
  readonly registrar?: (motivo: MotivoRespaldo, requestId?: string) => void;
}

type ConfiarEnSalto = (direccion: string | undefined, salto: number) => unknown;

/**
 * ¿El salto inmediato (la dirección del socket) está en `TRUST_PROXY`?
 *
 * Express lo documenta como "comprobar si `req.socket.remoteAddress` es de
 * confianza" y lo guarda compilado en el ajuste interno `trust proxy fn`. No
 * vale `req.ip`: si el salto es de confianza y no hay `X-Forwarded-For`,
 * `req.ip` coincide con el socket igual que si no lo fuera.
 */
function saltoInmediatoDeConfianza(req: Request): boolean {
  const confiar = req.app.get('trust proxy fn') as ConfiarEnSalto;
  return confiar(req.socket.remoteAddress, 0) === true;
}

function motivoDelRespaldo(
  saltoDeConfianza: boolean,
  cabecera: string | undefined,
): MotivoRespaldo {
  if (!saltoDeConfianza) return 'salto_no_confiable';
  return cabecera === undefined ? 'cabecera_ausente' : 'cabecera_invalida';
}

// Logs sin datos personales (security-engineering, regla 8): ni la IP del
// socket ni el valor de la cabecera, solo el motivo y el id de la petición, para
// poder correlar el aviso con su línea de acceso.
function registrarRespaldo(motivo: MotivoRespaldo, requestId?: string): void {
  registrarEnConsola({
    nivel: 'warn',
    mensaje: 'limitador: clave por req.ip en lugar de CF-Connecting-IP',
    motivo,
    ...(requestId === undefined ? {} : { request_id: requestId }),
  });
}

/**
 * Crea el `keyGenerator` de los limitadores.
 *
 * Usa `CF-Connecting-IP` SOLO si el salto inmediato es de confianza Y la
 * cabecera es una IP válida; en cualquier otro caso, `req.ip`. En ambos
 * caminos pasa por `ipKeyGenerator`, que agrupa las IPv6 por subred y unifica
 * las IPv4 escritas como IPv6 mapeadas.
 *
 * Al pasar un `keyGenerator` propio, `express-rate-limit` deja de ejecutar sus
 * comprobaciones del generador por defecto (`trust proxy` en `true`, IP
 * inválida…): `TRUST_PROXY` ya no puede ser `true` porque lo rechaza `cargarEnv`.
 */
export function crearClaveCliente(opciones: OpcionesClaveCliente): (req: Request) => string {
  const { detrasDeProxy, registrar = registrarRespaldo } = opciones;

  return (req) => {
    const saltoDeConfianza = saltoInmediatoDeConfianza(req);
    const cabecera = req.get(CABECERA_IP_CLIENTE);

    if (saltoDeConfianza && cabecera !== undefined && isIP(cabecera) !== 0) {
      return ipKeyGenerator(cabecera, PREFIJO_IPV6);
    }

    if (detrasDeProxy) {
      registrar(motivoDelRespaldo(saltoDeConfianza, cabecera), leerRequestId(req.res));
    }

    return req.ip === undefined ? CLAVE_SIN_IP : ipKeyGenerator(req.ip, PREFIJO_IPV6);
  };
}
