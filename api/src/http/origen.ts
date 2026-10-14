import type { RequestHandler } from 'express';
import { crearErrorHttp } from './errores';

/**
 * Segunda barrera anti-CSRF (la primera es `SameSite=Strict` en la cookie de
 * sesión): una petición que modifica datos solo se atiende si el navegador
 * declara que sale del frontend.
 *
 * Fuentes:
 *  - OWASP, CSRF Prevention Cheat Sheet: "Using Standard Headers to Verify
 *    Origin" (si `Origin` está presente, debe coincidir con el origen de
 *    destino configurado; "missing headers and `Origin: null` are not
 *    evidence of a same-origin request") y "Fetch Metadata" (`Sec-Fetch-Site`
 *    como señal principal; sin ninguna de las dos, bloquear es lo recomendado
 *    para endpoints sensibles).
 *  - Fetch Standard §3.2, "append a request `Origin` header": `fetch()` añade
 *    `Origin` a toda petición entre orígenes y, a las del mismo origen, a las
 *    que no son GET ni HEAD. `Origin` es un nombre de cabecera prohibido: el
 *    JavaScript de una página no puede falsearlo.
 *  - Fetch Metadata Request Headers (W3C) §2.3 y §4.2: valores `same-origin`,
 *    `same-site`, `cross-site` y `none`; el prefijo `Sec-` la hace inmodificable
 *    desde JavaScript. Solo se envía a URL fiables (https o localhost).
 *
 * Por qué no basta `SameSite`: delimita el SITIO (dominio registrable), no el
 * origen. Una página en otro subdominio de `carellabs.com` es "mismo sitio" y
 * el navegador le adjuntaría la cookie; `Origin` sí distingue los subdominios.
 */

/**
 * Métodos seguros por contrato (RFC 9110 §9.2.1: quien llama no pide ningún
 * efecto). Esa RFC da por seguro también a TRACE; aquí queda fuera adrede: la
 * lista es cerrada y todo lo demás se comprueba.
 *
 * Esta barrera no los comprueba, así que ninguno puede escribir: lo vigila
 * `tests/integration/objetivos-solo-lectura.test.ts` para cada `GET` de la API (ver
 * contrato-http.md).
 */
const METODOS_SEGUROS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Único valor de `Sec-Fetch-Site` que se acepta cuando no hay `Origin`. */
const SEC_FETCH_SITE_MISMO_ORIGEN = 'same-origin';

/**
 * ¿Declara la petición salir del frontend?
 *
 * - Con `Origin` (sea cual sea su valor, incluido `null` o vacío): decide solo
 *   él, y solo vale una igualdad EXACTA de texto con `origenPermitido`. Sin
 *   prefijos, sin parsear lo que manda el cliente y sin recurrir a
 *   `Sec-Fetch-Site`: si el origen declarado es otro, "same-origin" no lo salva.
 * - Sin `Origin`: solo vale `Sec-Fetch-Site: same-origin`.
 * - Sin ninguna de las dos: no. El único cliente es el navegador.
 *
 * `origenPermitido` es `ORIGEN_FRONTEND` ya validado por `cargarEnv` como un
 * origen exacto, que es la misma forma en la que el navegador serializa `Origin`.
 */
export function procedeDelFrontend(
  origenPermitido: string,
  origin: string | undefined,
  secFetchSite: string | undefined,
): boolean {
  if (origin !== undefined) return origin === origenPermitido;
  return secFetchSite === SEC_FETCH_SITE_MISMO_ORIGEN;
}

/**
 * Middleware: rechaza con 403 las peticiones que no son GET, HEAD ni OPTIONS
 * (POST, PUT, PATCH, DELETE y cualquier otro método) que no procedan del
 * frontend. La lista de métodos seguros es cerrada: lo desconocido se comprueba.
 *
 * El error pasa por el manejador central: formato `{ error: { codigo, mensaje,
 * request_id } }` y una línea de log en nivel `warn` con el método, la ruta sin
 * consulta y si venía cada cabecera (booleanos). Nunca el valor de las cabeceras.
 */
export function verificarOrigen(origenPermitido: string): RequestHandler {
  return (req, _res, next) => {
    if (METODOS_SEGUROS.has(req.method)) {
      next();
      return;
    }

    const origin = req.get('Origin');
    const secFetchSite = req.get('Sec-Fetch-Site');
    if (procedeDelFrontend(origenPermitido, origin, secFetchSite)) {
      next();
      return;
    }

    const rechazo = crearErrorHttp(403, 'Origen no permitido');
    // Sin esto, un `ORIGEN_FRONTEND` mal puesto en produccion haria fallar todas las
    // escrituras sin dejar rastro de por que. `warn`: es un rechazo del cliente, no un
    // fallo del servidor, pero hay que verlo. Solo la FORMA de la peticion: el valor de
    // `Origin` y de `Sec-Fetch-Site` no se registra nunca, y la ruta va sin consulta.
    rechazo.registro = {
      nivel: 'warn',
      campos: {
        metodo: req.method,
        ruta: req.baseUrl + req.path,
        origen_presente: origin !== undefined,
        sec_fetch_site_presente: secFetchSite !== undefined,
      },
    };
    next(rechazo);
  };
}
