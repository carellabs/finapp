/**
 * La politica de seguridad de las PAGINAS que sirve Caddy (docker/Caddyfile), escrita aqui una
 * sola vez para los tests que la comprueban (scripts/caddy.test.mjs, con un `dist` de prueba, y
 * scripts/imagen-web.test.mjs, con el build real). Es lo que un cambio descuidado no debe aflojar.
 */

/** Directivas de la CSP: sin 'unsafe-inline' ni 'unsafe-eval', todo del propio origen. */
export const CSP_ESPERADA = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'connect-src': ["'self'"],
  'frame-ancestors': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'self'"],
  'object-src': ["'none'"],
};

/** Cabeceras de las paginas (ademas de la CSP). Nombre en minusculas -> valor exacto. */
export const CABECERAS_DE_PAGINA = {
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'permissions-policy':
    'accelerometer=(), bluetooth=(), browsing-topics=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), hid=(), magnetometer=(), microphone=(), midi=(), payment=(), serial=(), usb=()',
  'cross-origin-opener-policy': 'same-origin',
  // Nadie de fuera embebe nuestros recursos. Igual que helmet en la API.
  'cross-origin-resource-policy': 'same-origin',
  // Los navegadores antiguos que no conocen `frame-ancestors`.
  'x-frame-options': 'DENY',
  // Igual, caracter a caracter, que la de helmet en la API
  // (api/tests/http/cabeceras-un-solo-origen.test.ts): dos valores distintos en un mismo origen
  // se pisarian segun que respuesta llegue ultima.
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};

/** `Cache-Control` de lo que lleva hash en el nombre (/assets/*). */
export const CACHE_INMUTABLE = 'public, max-age=31536000, immutable';
