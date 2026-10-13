import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id vía binarios precompilados: nada de toolchain de compilación en
 * la imagen final (§8.4). Nunca SHA ni un hash rápido para contraseñas.
 *
 * Sin opciones: Argon2id ya es el algoritmo por defecto de la librería. El
 * enum `Algorithm` es un const enum ambiental incompatible con
 * `verbatimModuleSyntax`, así que se evita importarlo directamente.
 */
export function hashearContrasena(contrasena: string): Promise<string> {
  return hash(contrasena);
}

export function verificarContrasena(hashAlmacenado: string, contrasena: string): Promise<boolean> {
  return verify(hashAlmacenado, contrasena);
}
