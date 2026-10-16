import { z } from 'zod';

/**
 * Entorno de los scripts de operación (`crear-usuario`): solo la base de datos.
 *
 * No reutiliza `cargarEnv`: esa función valida lo que necesita ARRANCAR la API (origen del
 * frontend, proxy de confianza, intervalos de las tareas...), y en producción exige
 * `TRUST_PROXY` y `ORIGEN_FRONTEND` aunque el script solo toque `DATABASE_URL`. Quien da de
 * alta el usuario en el servidor no tiene por qué conocerlas ni inventarlas.
 *
 * La regla de `DATABASE_URL` es la misma que la de `cargarEnv` (obligatoria, no vacía); un test
 * vigila que los dos cargadores coincidan.
 */
const esquemaEnvScripts = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),
});

export type EnvScripts = z.infer<typeof esquemaEnvScripts>;

export function cargarEnvScripts(fuente: NodeJS.ProcessEnv = process.env): EnvScripts {
  const resultado = esquemaEnvScripts.safeParse(fuente);

  if (!resultado.success) {
    const detalle = resultado.error.issues
      .map((problema) => `  - ${problema.path.join('.')}: ${problema.message}`)
      .join('\n');
    // Se listan los nombres de las variables, nunca sus valores.
    throw new Error(`Configuracion de entorno invalida:\n${detalle}`);
  }

  return resultado.data;
}
