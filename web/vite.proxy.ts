import type { ProxyOptions } from 'vite';

/**
 * Proxy de `/api` del servidor de desarrollo de Vite: el navegador solo habla con el origen de
 * la web (`localhost:5173`), igual que en producción (docker/Caddyfile). Así la `VITE_API_URL`
 * relativa por defecto funciona también en desarrollo, y no hace falta CORS ni cookies entre
 * puertos. Solo se usa en `vite dev`: el build de producción no lo lleva.
 */

/** La API publicada en loopback por el compose de desarrollo (o arrancada a mano en el host). */
const OBJETIVO_API_POR_DEFECTO = 'http://localhost:3000';

/**
 * Origen de la API al que reenviar `/api`, de `API_PROXY_TARGET`. Dentro de compose es el
 * servicio `api` (`http://api:3000`); si Vite corre en el host, el valor por defecto.
 *
 * Solo `esquema://host[:puerto]`: el proxy NO reescribe rutas (la API ya vive en `/api/v1`) y una
 * ruta en el destino las prefijaría. Un valor inválido hace fallar el arranque; el mensaje nombra
 * la variable, nunca su valor (podría llevar credenciales).
 */
export function objetivoProxyApi(configurado: string | undefined): string {
  if (configurado === undefined || configurado.trim() === '') return OBJETIVO_API_POR_DEFECTO;

  const invalido = new Error(
    'API_PROXY_TARGET debe ser un origen http(s) sin ruta, consulta ni credenciales: esquema://host[:puerto]',
  );
  let url: URL;
  try {
    url = new URL(configurado.trim());
  } catch {
    throw invalido;
  }
  const esOrigen =
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === '';
  if (!esOrigen) throw invalido;

  return url.origin;
}

/**
 * `server.proxy` de Vite. La clave es una expresión regular (Vite lo interpreta así si empieza
 * por `^`): con la cadena `/api` también se reenviaría `/apix`.
 */
export function proxyDeLaApi(configurado: string | undefined): Record<string, ProxyOptions> {
  return { '^/api(/|$)': { target: objetivoProxyApi(configurado) } };
}
