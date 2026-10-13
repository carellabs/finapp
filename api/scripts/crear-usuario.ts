#!/usr/bin/env -S npx tsx
/**
 * Crea el usuario de la aplicacion. La contrasena se pide de forma
 * INTERACTIVA y oculta en terminal: nunca por variable de entorno ni
 * argumento de linea de comandos, donde quedaria en el historial del shell
 * o en `ps`.
 */
import { createInterface } from 'node:readline';
import process from 'node:process';
import { cargarEnv } from '../src/config/env';
import { crearPool } from '../src/db/cliente';
import { hashearContrasena } from '../src/auth/contrasena';

function preguntar(pregunta: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(pregunta, (respuesta) => {
      rl.close();
      resolve(respuesta);
    });
  });
}

// Codigos de control por punto de codigo numerico (String.fromCharCode), no
// como escapes ni bytes literales en el fuente: evita cualquier ambiguedad
// de codificacion al leer o editar este archivo.
const CODIGO_ENTER_CR = 13;
const CODIGO_ENTER_LF = 10;
const CODIGO_CTRL_C = 3;
const CODIGO_BACKSPACE_DEL = 127;
const CODIGO_BACKSPACE_BS = 8;

/** Oculta la entrada en terminal: no hace eco de ningun caracter tecleado. */
function preguntarOculto(pregunta: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(pregunta);
    const stdin = process.stdin;
    const teniaRawMode = stdin.isTTY;
    if (teniaRawMode) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let valor = '';
    const onData = (fragmento: string): void => {
      const codigo = fragmento.charCodeAt(0);

      if (codigo === CODIGO_ENTER_CR || codigo === CODIGO_ENTER_LF) {
        if (teniaRawMode) stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write(String.fromCharCode(CODIGO_ENTER_LF));
        resolve(valor);
        return;
      }
      if (codigo === CODIGO_CTRL_C) {
        if (teniaRawMode) stdin.setRawMode(false);
        process.stdout.write(String.fromCharCode(CODIGO_ENTER_LF));
        process.exit(130);
      }
      if (codigo === CODIGO_BACKSPACE_DEL || codigo === CODIGO_BACKSPACE_BS) {
        valor = valor.slice(0, -1);
        return;
      }
      valor += fragmento;
    };
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const env = cargarEnv();
  const pool = crearPool(env.DATABASE_URL);

  try {
    const nombreUsuario = (await preguntar('Nombre de usuario: ')).trim();
    if (nombreUsuario.length === 0) {
      throw new Error('El nombre de usuario no puede estar vacio.');
    }

    const password = await preguntarOculto('Contrasena (no se mostrara): ');
    if (password.length < 8) {
      throw new Error('La contrasena debe tener al menos 8 caracteres.');
    }
    const confirmacion = await preguntarOculto('Repite la contrasena: ');
    if (password !== confirmacion) {
      throw new Error('Las contrasenas no coinciden.');
    }

    const passwordHash = await hashearContrasena(password);

    await pool.query(
      `INSERT INTO usuarios (nombre_usuario, password_hash) VALUES ($1, $2)
       ON CONFLICT (nombre_usuario) DO UPDATE SET password_hash = EXCLUDED.password_hash,
         intentos_fallidos = 0, bloqueado_hasta = NULL`,
      [nombreUsuario, passwordHash],
    );

    console.log(`Usuario "${nombreUsuario}" creado/actualizado correctamente.`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
