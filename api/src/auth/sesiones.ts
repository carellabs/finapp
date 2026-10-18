import type { Pool } from '../db/cliente';
import { enTransaccion } from '../db/transaccion';
import { generarToken, hashearToken } from './token';

/** Duración de una sesión. Personal, un solo usuario: se prioriza no tener que
 * reautenticar constantemente sobre una expiración agresiva. */
const DURACION_SESION_MS = 30 * 24 * 60 * 60 * 1000;

export interface SesionCreada {
  readonly token: string;
  readonly expiraEn: Date;
}

export interface OpcionesCrearSesion {
  /** Máximo de sesiones del usuario tras crear esta (`MAX_SESIONES_POR_USUARIO`). */
  readonly maxSesiones: number;
  /**
   * El hash guardado con el que se verificó la contraseña de este inicio de sesión. OBLIGATORIO:
   * `crearSesion` comprueba bajo el bloqueo del usuario que sigue siendo el vigente, y quien la
   * llame sin él no podría autenticar. Ver `crearSesion`.
   */
  readonly passwordHashVerificado: string;
  /**
   * Token de la sesión con la que llega el navegador (cookie `sid`), si trae
   * alguna: se revoca antes de crear la nueva (rotación). Solo si es del propio
   * usuario que inicia sesión.
   */
  readonly tokenPrevio?: string | undefined;
}

/**
 * Crea una sesión y devuelve el token EN CLARO (solo esta vez): la BD guarda su hash.
 *
 * Todo ocurre en UNA transacción (`enTransaccion`: READ COMMITTED, con `lock_timeout`),
 * y es lo que hace correcto el límite:
 *
 * 1. Bloquea la fila del usuario (`FOR NO KEY UPDATE`). Dos inicios de sesión
 *    simultáneos del mismo usuario se ponen en cola aquí. Sin esto, en READ
 *    COMMITTED cada transacción ve solo las sesiones ya confirmadas y no las
 *    que la otra acaba de insertar: ambas podarían "lo suyo" y, juntas, dejarían
 *    más de N. Tampoco bastaría una sola sentencia (CTE con INSERT y DELETE):
 *    comparten instantánea y no verían la inserción de la concurrente. El
 *    bloqueo se libera con el COMMIT, así que la siguiente ya ve la anterior.
 *    `NO KEY UPDATE` y no `UPDATE`: no choca con el `FOR KEY SHARE` que toma la
 *    comprobación de la clave foránea al insertar, solo con otros iguales.
 *    Con el bloqueo ya tomado LEE el hash vigente (`password_hash`) y lo compara, entero,
 *    con `passwordHashVerificado`: si no es el mismo (la contraseña se cambió entre que el
 *    login la verificó y este momento) o el usuario ya no existe, devuelve `null` sin crear
 *    ni revocar nada. El bloqueo SOLO no basta: el login autentica (lee el hash y corre
 *    Argon2) ANTES de llegar aquí, sin bloqueo, así que un cambio de contraseña que confirme
 *    en medio dejaría una sesión viva autenticada con la contraseña antigua. Con la
 *    comprobación, `guardarUsuario` y este paso se ordenan por el bloqueo: si el cambio gana,
 *    aquí se ve el hash nuevo; si gana este login, su sesión la cierra el borrado del cambio.
 * 2. Reinicia `intentos_fallidos` y `bloqueado_hasta` (el login correcto los pone a cero) en esta
 *    misma transacción, solo si el hash coincide.
 * 3. Revoca la sesión previa, si es de este usuario (ver `OpcionesCrearSesion`).
 *    Va antes del límite: la que se va deja hueco y no obliga a podar otra.
 * 4. Inserta la nueva. `created_at` es `clock_timestamp()` y no el `now()` por
 *    defecto: `now()` es el instante en que EMPIEZA la transacción, que con
 *    transacciones en cola no coincide con el orden en que se insertan.
 * 5. Poda: conserva la nueva y las `maxSesiones - 1` más recientes de las demás.
 *    La nueva se excluye de la poda por id y no por fecha: si el reloj del
 *    servidor retrocediera, ordenar por fecha podría borrar la sesión que se
 *    acaba de entregar y el usuario recibiría una cookie muerta.
 */
export async function crearSesion(
  pool: Pool,
  usuarioId: string,
  opciones: OpcionesCrearSesion,
): Promise<SesionCreada | null> {
  const { maxSesiones, tokenPrevio, passwordHashVerificado } = opciones;
  const token = generarToken();
  const expiraEn = new Date(Date.now() + DURACION_SESION_MS);

  const creada = await enTransaccion(pool, async (cliente) => {
    const { rows: vigente } = await cliente.query<{ password_hash: string }>(
      'SELECT password_hash FROM usuarios WHERE id = $1 FOR NO KEY UPDATE',
      [usuarioId],
    );
    // El mismo resultado para "ya no existe" y "la contraseña cambió": el llamador no distingue.
    // La comparación detecta un cambio de contraseña (también a la MISMA contraseña) porque cada
    // hash lleva una sal aleatoria que Argon2 genera nueva en cada llamada: dos hashes de la misma
    // contraseña nunca coinciden. Si algún día el hash fuera determinista (sal fija), un cambio a
    // la misma contraseña pasaría desapercibido aquí; lo fija `tests/auth/contrasena.test.ts`.
    if (vigente[0]?.password_hash !== passwordHashVerificado) return false;

    // Reinicia el contador de intentos y el bloqueo, y solo aquí: bajo el bloqueo y con el hash
    // comprobado. Un login en vuelo con la contraseña antigua (que devuelve `false` arriba) no
    // puede borrar un bloqueo legítimo contra la contraseña nueva.
    await cliente.query(
      'UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1',
      [usuarioId],
    );

    if (tokenPrevio !== undefined) {
      // Acotado al usuario: iniciar sesión como A no da poder sobre las sesiones de B.
      await cliente.query('DELETE FROM sesiones WHERE token_hash = $1 AND usuario_id = $2', [
        hashearToken(tokenPrevio),
        usuarioId,
      ]);
    }

    const { rows } = await cliente.query<{ id: string }>(
      `INSERT INTO sesiones (usuario_id, token_hash, expira_en, created_at)
       VALUES ($1, $2, $3, clock_timestamp())
       RETURNING id`,
      [usuarioId, hashearToken(token), expiraEn],
    );
    const nuevaId = rows[0]?.id;
    if (nuevaId === undefined) throw new Error('INSERT de la sesion no devolvio fila');

    await cliente.query(
      `DELETE FROM sesiones
       WHERE usuario_id = $1
         AND id <> $2
         AND id NOT IN (
           SELECT id FROM sesiones
           WHERE usuario_id = $1 AND id <> $2
           ORDER BY created_at DESC
           LIMIT $3
         )`,
      [usuarioId, nuevaId, maxSesiones - 1],
    );
    return true;
  });

  return creada ? { token, expiraEn } : null;
}

/** `null` si el token no existe o ha expirado: nunca distingue el motivo al llamador HTTP. */
export async function verificarSesion(pool: Pool, token: string): Promise<string | null> {
  const { rows } = await pool.query<{ usuario_id: string }>(
    'SELECT usuario_id FROM sesiones WHERE token_hash = $1 AND expira_en > now()',
    [hashearToken(token)],
  );
  return rows[0]?.usuario_id ?? null;
}

export async function revocarSesion(pool: Pool, token: string): Promise<void> {
  await pool.query('DELETE FROM sesiones WHERE token_hash = $1', [hashearToken(token)]);
}

/**
 * Housekeeping: sesiones caducadas no necesitan quedarse en la tabla. Ya no
 * autentican (`verificarSesion` mira `expira_en`): borrarlas no cambia ningún
 * resultado, solo evita que la tabla crezca. Devuelve cuántas borró.
 */
export async function purgarSesionesCaducadas(pool: Pool): Promise<number> {
  const resultado = await pool.query('DELETE FROM sesiones WHERE expira_en <= now()');
  return resultado.rowCount ?? 0;
}
