/**
 * Crea el usuario de la aplicacion (o le cambia la contrasena). La contrasena se pide de forma
 * INTERACTIVA y oculta en una terminal, dos veces: nunca por variable de entorno, argumento ni
 * tuberia, donde quedaria en el historial del shell, en `ps` o en un fichero. Sin terminal,
 * el script falla sin crear nada.
 *
 * Solo necesita DATABASE_URL (no las variables de arranque de la API). La logica esta en
 * `src/auth/alta-usuario.ts`; esto solo la conecta a la terminal y a la base de datos.
 *
 *   desarrollo:  npm run crear-usuario -w @finapp/api
 *   produccion:  node dist/crear-usuario.js   (el script se compila junto a la API; ver tsup)
 */
import process from 'node:process';
import { altaUsuario, describirFallo } from '../src/auth/alta-usuario';
import { hashearContrasena } from '../src/auth/contrasena';
import { guardarUsuario } from '../src/auth/usuarios';
import { cargarEnvScripts } from '../src/config/env-scripts';
import { crearPool } from '../src/db/cliente';
import { leerLinea, leerOculto } from '../src/infra/terminal';

async function main(): Promise<void> {
  const env = cargarEnvScripts();
  // Un pool no abre ninguna conexion hasta la primera consulta.
  const pool = crearPool(env.DATABASE_URL);

  try {
    await altaUsuario({
      esInteractivo: process.stdin.isTTY === true,
      preguntar: (pregunta) => leerLinea(pregunta, process.stdin, process.stdout),
      preguntarOculto: (pregunta) => leerOculto(pregunta, process.stdin, process.stdout),
      hashear: hashearContrasena,
      guardar: (nombreUsuario, passwordHash) => guardarUsuario(pool, nombreUsuario, passwordHash),
      escribir: (linea) => {
        console.log(linea);
      },
    });
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const fallo = describirFallo(error);
  console.error(fallo.mensaje);
  process.exitCode = fallo.codigo;
});
