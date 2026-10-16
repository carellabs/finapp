/**
 * ¿Es CLAVE la contraseña de HASH? Sale con 0 si coincide y con 1 si no. Se ejecuta DENTRO de la
 * imagen del pty (scripts/pty/Dockerfile: la de production, con `@node-rs/argon2`), lanzada por
 * scripts/verificar-imagenes.mjs: así se verifica con la misma librería que usa la API, sin instalar
 * nada en el host. HASH y CLAVE llegan por el entorno del contenedor, nunca por argumentos.
 */
import { verify } from '@node-rs/argon2';

const { HASH, CLAVE } = process.env;
if (HASH === undefined || CLAVE === undefined) {
  console.error('Faltan HASH y CLAVE en el entorno.');
  process.exit(2);
}
process.exit((await verify(HASH, CLAVE)) ? 0 : 1);
