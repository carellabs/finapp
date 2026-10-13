import type { Pool } from '../db/cliente';

/**
 * Bloqueo por fuerza bruta persistido en la tabla `usuarios` (§8.1): así
 * reiniciar el contenedor no borra un bloqueo activo, a diferencia de un
 * contador en memoria del proceso.
 */
const MAX_INTENTOS_FALLIDOS = 5;
const DURACION_BLOQUEO_MS = 15 * 60 * 1000;

export interface EstadoUsuario {
  readonly id: string;
  readonly passwordHash: string;
  readonly bloqueadoHasta: Date | null;
}

export async function buscarUsuarioPorNombre(
  pool: Pool,
  nombreUsuario: string,
): Promise<EstadoUsuario | null> {
  const { rows } = await pool.query<{
    id: string;
    password_hash: string;
    bloqueado_hasta: Date | null;
  }>('SELECT id, password_hash, bloqueado_hasta FROM usuarios WHERE nombre_usuario = $1', [
    nombreUsuario,
  ]);
  const fila = rows[0];
  if (fila === undefined) return null;
  return { id: fila.id, passwordHash: fila.password_hash, bloqueadoHasta: fila.bloqueado_hasta };
}

export function estaBloqueado(usuario: EstadoUsuario, ahora: Date = new Date()): boolean {
  return usuario.bloqueadoHasta !== null && usuario.bloqueadoHasta > ahora;
}

/** Incrementa el contador de fallos y, al alcanzar el máximo, activa el bloqueo temporal. */
export async function registrarIntentoFallido(pool: Pool, usuarioId: string): Promise<void> {
  await pool.query(
    `UPDATE usuarios
     SET intentos_fallidos = intentos_fallidos + 1,
         bloqueado_hasta = CASE
           WHEN intentos_fallidos + 1 >= $2 THEN now() + ($3 || ' milliseconds')::interval
           ELSE bloqueado_hasta
         END
     WHERE id = $1`,
    [usuarioId, MAX_INTENTOS_FALLIDOS, DURACION_BLOQUEO_MS],
  );
}

export async function reiniciarIntentosFallidos(pool: Pool, usuarioId: string): Promise<void> {
  await pool.query(
    'UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1',
    [usuarioId],
  );
}
