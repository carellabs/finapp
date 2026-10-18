import type { Pool } from '../db/cliente';
import { enTransaccion } from '../db/transaccion';

export interface ResultadoGuardado {
  /** Sesiones abiertas del usuario que se han cerrado al guardar (0 si es un usuario nuevo). */
  readonly sesionesCerradas: number;
}

/**
 * Crea el usuario o, si ya existe, le cambia la contraseña, le quita el bloqueo (los intentos
 * fallidos y `bloqueado_hasta`) y le CIERRA TODAS LAS SESIONES abiertas: es lo que hace falta
 * cuando se olvida la contraseña, la cuenta se bloquea por fuerza bruta o se sospecha un acceso
 * (quien tenga una cookie de antes no debe seguir dentro). Solo recibe el HASH: la contraseña no
 * llega hasta aquí.
 *
 * Todo en UNA transacción (`enTransaccion`): o cambian el hash y se cierran las sesiones, o no
 * pasa ninguna de las dos cosas. Y se serializa con los inicios de sesión:
 *
 * - El `UPDATE` del upsert toma el bloqueo de la fila del usuario (`FOR NO KEY UPDATE`), el
 *   MISMO que `crearSesion`, y lo retiene hasta el COMMIT. Si un login ya lo tiene, el cambio
 *   espera, y el `DELETE` (otra sentencia, con instantánea nueva en READ COMMITTED) ve la sesión
 *   que ese login acaba de confirmar y la cierra. Por eso el borrado va DESPUÉS del upsert.
 * - Si el login llega después, espera a este COMMIT y `crearSesion` vuelve a leer el hash bajo
 *   el bloqueo: si no es el que verificó, no crea la sesión (ver `crearSesion`). Sin esa
 *   comprobación el bloqueo no bastaría: el login autentica ANTES de pedirlo.
 *
 * Un usuario nuevo no tiene sesiones (la clave foránea lo impide), así que el `DELETE` no borra
 * nada; no se ramifica por ello. Solo toca `usuarios` y `sesiones` con INSERT/UPDATE/DELETE: el
 * rol de la base de datos de la aplicación (sin DDL, ver db-conventions) basta para ejecutarla.
 */
export async function guardarUsuario(
  pool: Pool,
  nombreUsuario: string,
  passwordHash: string,
): Promise<ResultadoGuardado> {
  return enTransaccion(pool, async (cliente) => {
    const { rows } = await cliente.query<{ id: string }>(
      `INSERT INTO usuarios (nombre_usuario, password_hash) VALUES ($1, $2)
       ON CONFLICT (nombre_usuario) DO UPDATE SET password_hash = EXCLUDED.password_hash,
         intentos_fallidos = 0, bloqueado_hasta = NULL
       RETURNING id`,
      [nombreUsuario, passwordHash],
    );
    const usuarioId = rows[0]?.id;
    if (usuarioId === undefined) throw new Error('El upsert del usuario no devolvio fila');

    const cerradas = await cliente.query('DELETE FROM sesiones WHERE usuario_id = $1', [usuarioId]);
    return { sesionesCerradas: cerradas.rowCount ?? 0 };
  });
}
