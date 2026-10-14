export const COOKIE_SESION = 'sid';

/**
 * El token de sesión de la petición, o `undefined` si no hay uno utilizable.
 *
 * `cookie-parser` convierte en JSON toda cookie cuyo valor empieza por `j:`
 * (`sid=j:123` llega como el número 123, `sid=j:{"a":1}` como un objeto), así
 * que `req.cookies.sid` no siempre es un texto. Hashear algo que no lo es lanza
 * un `TypeError` y la API respondía 500 a una cookie manipulada. Aquí se
 * decide una sola vez: lo que no sea un texto no vacío equivale a no tener
 * cookie. Es el único sitio que lee la cookie de sesión.
 */
export function leerTokenSesion(req: { readonly cookies?: unknown }): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | null | undefined;
  const valor = cookies?.[COOKIE_SESION];
  return typeof valor === 'string' && valor !== '' ? valor : undefined;
}
