import { createHash, randomBytes } from 'node:crypto';

/**
 * Token de sesión de alta entropía. Se hashea con SHA-256 (no Argon2id):
 * Argon2id existe para contraseñas ADIVINABLES por humanos; un token
 * aleatorio de 256 bits no lo es, y un hash rápido es lo correcto para una
 * búsqueda por igualdad en cada petición.
 */
export function generarToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashearToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
