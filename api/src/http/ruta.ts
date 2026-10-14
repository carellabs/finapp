/** Cuántos caracteres de la ruta de una petición se escriben en el log. */
export const LONGITUD_MAXIMA_DE_RUTA = 200;
/** Se añade a una ruta que se ha cortado. */
export const MARCA_RUTA_TRUNCADA = '…[truncada]';

/** Esquema y autoridad de la forma absoluta (`http://usuario:clave@host:8443`). */
const ESQUEMA_Y_AUTORIDAD = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i;

/**
 * La ruta de una petición para escribirla en un log, a partir de `req.originalUrl`.
 *
 * `originalUrl` es el texto CRUDO de la línea de petición y lo elige el cliente: puede ser
 * la forma absoluta con credenciales (`GET http://usuario:clave@host/health`), traer un
 * fragmento (`#…`), una consulta con filtros o secretos, o medir 15 KB. Aquí se queda solo
 * la ruta, sin esquema, autoridad, consulta ni fragmento, y con un tope de
 * `LONGITUD_MAXIMA_DE_RUTA` caracteres más una marca.
 *
 * Parte de `originalUrl` y no de `req.path`: éste es relativo al punto de montaje del
 * middleware (bajo `/api/v1`, `/transacciones`), y `originalUrl` es la misma desde cualquier
 * sitio de la cadena.
 */
export function rutaDePeticion(url: string): string {
  const absoluta = ESQUEMA_Y_AUTORIDAD.exec(url);
  const resto = absoluta === null ? url : url.slice(absoluta[0].length);
  const corte = resto.search(/[?#]/);
  const sinConsulta = corte === -1 ? resto : resto.slice(0, corte);
  // La forma absoluta sin ruta (`http://host`) es la raíz.
  const ruta = absoluta !== null && sinConsulta === '' ? '/' : sinConsulta;

  return ruta.length > LONGITUD_MAXIMA_DE_RUTA
    ? ruta.slice(0, LONGITUD_MAXIMA_DE_RUTA) + MARCA_RUTA_TRUNCADA
    : ruta;
}
