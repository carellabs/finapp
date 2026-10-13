import type { Pool } from '../db/cliente';
import { generarToken, hashearToken } from './token';

/** Duración de una sesión. Personal, un solo usuario: se prioriza no tener que
 * reautenticar constantemente sobre una expiración agresiva. */
const DURACION_SESION_MS = 30 * 24 * 60 * 60 * 1000;

export interface SesionCreada {
  readonly token: string;
  readonly expiraEn: Date;
}

/** Crea una sesión y devuelve el token EN CLARO (solo esta vez): la BD guarda su hash. */
export async function crearSesion(pool: Pool, usuarioId: string): Promise<SesionCreada> {
  const token = generarToken();
  const expiraEn = new Date(Date.now() + DURACION_SESION_MS);

  await pool.query('INSERT INTO sesiones (usuario_id, token_hash, expira_en) VALUES ($1, $2, $3)', [
    usuarioId,
    hashearToken(token),
    expiraEn,
  ]);

  return { token, expiraEn };
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

/** Housekeeping: sesiones caducadas no necesitan quedarse en la tabla. */
export async function purgarSesionesCaducadas(pool: Pool): Promise<void> {
  await pool.query('DELETE FROM sesiones WHERE expira_en <= now()');
}
