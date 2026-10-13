import { z } from 'zod';

/**
 * Configuracion validada en el arranque. Si falta algo, el proceso NO arranca:
 * un servidor a medio configurar falla mas tarde y peor.
 */
const esquemaEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),
  ORIGEN_FRONTEND: z.string().min(1, 'ORIGEN_FRONTEND es obligatorio'),
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
