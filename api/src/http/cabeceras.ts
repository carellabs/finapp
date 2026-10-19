import type { RequestHandler } from 'express';
import type { HelmetOptions } from 'helmet';

/**
 * Las cabeceras de seguridad de las respuestas de la API (todas son JSON, ningún documento). Las
 * de las PÁGINAS las pone Caddy (`docker/Caddyfile`) y no se aplican a `/api` ni a `/health`:
 * son respuestas distintas del mismo origen.
 */

/**
 * Opciones de helmet, explícitas: no se confía en sus valores por defecto, que traen una CSP
 * pensada para páginas (`style-src 'unsafe-inline'`, `font-src https: data:`,
 * `upgrade-insecure-requests`, `frame-ancestors 'self'`).
 *
 *  - CSP: una respuesta JSON no carga nada, así que `default-src 'none'`. `frame-ancestors` va
 *    aparte porque NO hereda de `default-src`. `base-uri`, `form-action` y `object-src` no se
 *    ponen: en una respuesta que no es HTML no tienen efecto, y la política más corta es la
 *    más fácil de auditar.
 *  - `X-Frame-Options: DENY`, el equivalente de `frame-ancestors 'none'` para los navegadores que no
 *    conocen la CSP, y el mismo valor que Caddy en las páginas (helmet pone `SAMEORIGIN`).
 *
 * El resto de las cabeceras de helmet (HSTS, `nosniff`, `Referrer-Policy`, CORP, COOP…) se quedan
 * con sus valores por defecto: HSTS y CORP tienen que coincidir con las de Caddy
 * (`api/tests/http/cabeceras-un-solo-origen.test.ts` lo cruza).
 */
export const OPCIONES_HELMET: Readonly<HelmetOptions> = {
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      'default-src': ["'none'"],
      'frame-ancestors': ["'none'"],
    },
  },
  xFrameOptions: { action: 'deny' },
};

/**
 * `Cache-Control: no-store` en TODA respuesta de la API: son datos financieros del usuario y ni el
 * navegador ni un intermediario deben guardarlos. Incluye `/health` (un monitor no gana nada
 * cacheando el estado) y los errores. Va antes de `helmet`, `cors` y la comprobación de origen
 * (`app.ts`): lo que se responde sin llegar a las rutas (la petición previa de CORS, los 403, los
 * 429, los 400/413/415 del lector del cuerpo) también la lleva.
 */
export const sinCache: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};
