import { z } from 'zod';
import { interpretarTrustProxy } from './trust-proxy';

/**
 * ¿Es `valor` un origen http(s) escrito EXACTAMENTE como lo serializa el
 * navegador en la cabecera `Origin`: `esquema://host[:puerto]`, en minúsculas,
 * sin el puerto por defecto, sin barra final, ruta, consulta ni credenciales?
 *
 * `new URL(valor).origin` es esa serialización, así que el valor es válido si
 * y solo si coincide con ella. CORS y la comprobación anti-CSRF lo comparan
 * como texto con lo que manda el navegador: un valor que no coincida nunca
 * casaría y la API rechazaría todas las peticiones que modifican datos sin
 * decir por qué. Por eso se rechaza en el arranque y no se "arregla" aquí.
 */
function esOrigenExacto(valor: string): boolean {
  try {
    const url = new URL(valor);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === valor;
  } catch {
    return false;
  }
}

/**
 * Entero decimal en [min, max]. Sin definir, vacío o solo espacios vale `defecto`:
 * el compose de desarrollo pasa `${VAR:-}` (vacío) cuando la variable no está en
 * `.env`, y eso tiene que significar "el valor por defecto", no un error.
 *
 * Solo dígitos: `z.coerce.number()` aceptaría también `1e1`, `0x10` o ` 7`, y un
 * valor así de raro casi siempre es un error de quien despliega. El mensaje
 * nombra el rango, nunca el valor recibido.
 */
function enteroDecimal(min: number, max: number, defecto: number) {
  const motivo = `debe ser un entero decimal entre ${min} y ${max}`;
  return z.preprocess(
    (valor) => (typeof valor === 'string' && valor.trim() === '' ? undefined : valor),
    z
      .string()
      .trim()
      .regex(/^\d+$/, motivo)
      .transform(Number)
      .pipe(z.number().min(min, motivo).max(max, motivo))
      .default(defecto),
  );
}

// Nombra la variable, NUNCA el valor recibido (cargarEnv no vuelca valores).
const MOTIVO_ORIGEN_FRONTEND =
  'debe ser un origen exacto: esquema http o https, host en minusculas y puerto solo si no es el de por defecto, sin barra final, ruta, consulta ni credenciales';

// En produccion la cookie de sesion es `Secure` y la app se sirve por HTTPS detras de Cloudflare.
const MOTIVO_ORIGEN_HTTPS = 'en produccion debe ser https';

/**
 * Configuracion validada en el arranque. Si falta algo, el proceso NO arranca:
 * un servidor a medio configurar falla mas tarde y peor.
 */
const esquemaEnv = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().max(65535).default(3000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),
    ORIGEN_FRONTEND: z
      .string()
      .min(1, 'ORIGEN_FRONTEND es obligatorio')
      .refine(esOrigenExacto, MOTIVO_ORIGEN_FRONTEND),
    // En crudo; se interpreta abajo porque la regla depende de NODE_ENV.
    TRUST_PROXY: z.string().optional(),
    // Al iniciar sesión se borran las más antiguas hasta quedar en este número.
    // Personal: móvil, portátil, tablet y algún navegador más.
    MAX_SESIONES_POR_USUARIO: enteroDecimal(1, 50, 5),
    // Cada cuánto se purgan las sesiones caducadas. Ya no autentican (se
    // comprueba `expira_en` en cada petición): purgar es solo higiene de la tabla.
    PURGA_SESIONES_INTERVALO_MINUTOS: enteroDecimal(1, 1440, 60),
  })
  .transform((datos, ctx) => {
    const enProduccion = datos.NODE_ENV === 'production';
    const trustProxy = interpretarTrustProxy(datos.TRUST_PROXY, enProduccion);
    // `esOrigenExacto` ya garantizo el esquema en minusculas: basta mirar el prefijo.
    const origenSinHttps = enProduccion && !datos.ORIGEN_FRONTEND.startsWith('https://');

    // Se comprueban las dos antes de abortar: quien arregla el despliegue ve todo de una vez.
    if (!trustProxy.ok) {
      ctx.addIssue({ code: 'custom', path: ['TRUST_PROXY'], message: trustProxy.motivo });
    }
    if (origenSinHttps) {
      ctx.addIssue({ code: 'custom', path: ['ORIGEN_FRONTEND'], message: MOTIVO_ORIGEN_HTTPS });
    }
    if (!trustProxy.ok || origenSinHttps) return z.NEVER;

    return { ...datos, TRUST_PROXY: trustProxy.valor };
  });

export type Env = z.infer<typeof esquemaEnv>;

export function cargarEnv(fuente: NodeJS.ProcessEnv = process.env): Env {
  const resultado = esquemaEnv.safeParse(fuente);

  if (!resultado.success) {
    const detalle = resultado.error.issues
      .map((problema) => `  - ${problema.path.join('.')}: ${problema.message}`)
      .join('\n');
    // Se listan los nombres de las variables, nunca sus valores.
    throw new Error(`Configuracion de entorno invalida:\n${detalle}`);
  }

  return resultado.data;
}
