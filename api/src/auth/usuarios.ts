import type { Pool } from '../db/cliente';

/**
 * Crea el usuario o, si ya existe, le cambia la contraseña y le quita el bloqueo (los intentos
 * fallidos y `bloqueado_hasta`): es lo que hace falta cuando se olvida la contraseña o la
 * cuenta se bloquea por fuerza bruta. Solo recibe el HASH: la contraseña no llega hasta aquí.
 *
 * Solo toca `usuarios` con INSERT/UPDATE: el rol de la base de datos de la aplicación (sin DDL,
 * ver db-conventions) basta para ejecutarla.
 */
export async function guardarUsuario(
  pool: Pool,
  nombreUsuario: string,
  passwordHash: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO usuarios (nombre_usuario, password_hash) VALUES ($1, $2)
     ON CONFLICT (nombre_usuario) DO UPDATE SET password_hash = EXCLUDED.password_hash,
       intentos_fallidos = 0, bloqueado_hasta = NULL`,
    [nombreUsuario, passwordHash],
  );
}
