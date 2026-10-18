import { zLogin } from '@finapp/shared';
import { EntradaCancelada } from '../infra/terminal';

/**
 * Alta (o cambio de contraseña) del usuario de la aplicación, desde un terminal. La lógica del
 * script `crear-usuario`, sin tocar `process` ni la base de datos: todo entra por
 * `DependenciasAlta`, así que se prueba entera.
 *
 * La contraseña solo se pide por teclado en un terminal interactivo. Nunca por argumentos,
 * variables de entorno ni tuberías (acabarían en el historial del shell, en `ps`, en un
 * fichero), y nunca se escribe: ni en la salida, ni en los errores, ni en los logs. Solo se
 * guarda su hash Argon2id.
 */

/** Mínimo de la contraseña. Es una regla del alta: el login acepta cualquiera ya guardada. */
export const LONGITUD_MINIMA_CONTRASENA = 8;

/** Un fallo que se le cuenta a quien ejecuta el script: su mensaje es para mostrarlo tal cual. */
export class ErrorAltaUsuario extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorAltaUsuario';
  }
}

export interface DependenciasAlta {
  /** ¿La entrada estándar es un terminal? Sin terminal no se pide nada. */
  readonly esInteractivo: boolean;
  /** Pregunta que se ve mientras se teclea (el nombre de usuario). */
  readonly preguntar: (pregunta: string) => Promise<string>;
  /** Pregunta SIN eco (la contraseña). */
  readonly preguntarOculto: (pregunta: string) => Promise<string>;
  readonly hashear: (contrasena: string) => Promise<string>;
  /** Guarda el usuario (o le cambia la contraseña) y dice cuántas sesiones abiertas cerró. */
  readonly guardar: (
    nombreUsuario: string,
    passwordHash: string,
  ) => Promise<{ readonly sesionesCerradas: number }>;
  readonly escribir: (linea: string) => void;
}

const MENSAJE_SIN_TERMINAL =
  'La contrasena solo se pide en una terminal interactiva: no se acepta por tuberia, ' +
  'redireccion, argumentos ni variables de entorno. Ejecuta el script en una terminal ' +
  '(por ejemplo con `docker run -it` o `docker compose run`, sin redirigir la entrada).';

/** El nombre, con los mismos límites que el login (`zLogin`): si no, no podría iniciar sesión. */
function validarNombre(nombreUsuario: string): void {
  if (!zLogin.shape.nombreUsuario.safeParse(nombreUsuario).success) {
    const maximo = zLogin.shape.nombreUsuario.maxLength;
    throw new ErrorAltaUsuario(
      `El nombre de usuario debe tener entre 1 y ${String(maximo)} caracteres.`,
    );
  }
}

/** Mínimo propio del alta, y el máximo del login (`zLogin`). Los mensajes no incluyen la clave. */
function validarContrasena(contrasena: string): void {
  if (contrasena.length < LONGITUD_MINIMA_CONTRASENA) {
    throw new ErrorAltaUsuario(
      `La contrasena debe tener al menos ${String(LONGITUD_MINIMA_CONTRASENA)} caracteres.`,
    );
  }
  if (!zLogin.shape.password.safeParse(contrasena).success) {
    const maximo = zLogin.shape.password.maxLength;
    throw new ErrorAltaUsuario(
      `La contrasena no puede tener mas de ${String(maximo)} caracteres: el login no la aceptaria.`,
    );
  }
}

/** Código de salida del script si se cancela (la convención de Ctrl-C: 128 + SIGINT). */
const CODIGO_CANCELADO = 130;

export interface FalloDelAlta {
  /** Lo que se le cuenta a quien ejecuta el script (por stderr). */
  readonly mensaje: string;
  /** El código de salida del proceso. */
  readonly codigo: number;
}

const MENSAJE_BASE_OCUPADA =
  'No se ha cambiado nada: la base de datos estaba ocupada. Vuelve a intentarlo.';

/**
 * ¿Postgres abortó la transacción por una espera de bloqueo (`55P03`, `lock_timeout`) o un
 * interbloqueo (`40P01`)? En ambos la transacción se ha revertido entera y se puede repetir.
 */
function esBaseOcupada(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return error.code === '55P03' || error.code === '40P01';
}

/**
 * Cómo termina el script cuando algo falla. Lo que no es un `Error` no se vuelca (no se sabe qué
 * lleva); los mensajes de los errores de validación nunca incluyen la contraseña.
 */
export function describirFallo(error: unknown): FalloDelAlta {
  if (error instanceof EntradaCancelada) {
    return { mensaje: 'Cancelado: no se ha creado nada.', codigo: CODIGO_CANCELADO };
  }
  if (esBaseOcupada(error)) {
    // `guardarUsuario` es una transacción: nada se ha cambiado. Sin el texto de Postgres.
    return { mensaje: MENSAJE_BASE_OCUPADA, codigo: 1 };
  }
  if (error instanceof Error) return { mensaje: error.message, codigo: 1 };
  return { mensaje: 'Error desconocido.', codigo: 1 };
}

export async function altaUsuario(deps: DependenciasAlta): Promise<void> {
  if (!deps.esInteractivo) throw new ErrorAltaUsuario(MENSAJE_SIN_TERMINAL);

  const nombreUsuario = (await deps.preguntar('Nombre de usuario: ')).trim();
  validarNombre(nombreUsuario);

  const contrasena = await deps.preguntarOculto('Contrasena (no se mostrara): ');
  validarContrasena(contrasena);
  const repeticion = await deps.preguntarOculto('Repite la contrasena: ');
  if (contrasena !== repeticion) throw new ErrorAltaUsuario('Las contrasenas no coinciden.');

  const { sesionesCerradas } = await deps.guardar(nombreUsuario, await deps.hashear(contrasena));

  deps.escribir(`Usuario "${nombreUsuario}" creado/actualizado correctamente.`);
  if (sesionesCerradas > 0) deps.escribir(avisoSesionesCerradas(sesionesCerradas));
}

/** Solo el número: ni la contraseña, ni el hash, ni nada de las sesiones (ids, tokens). */
function avisoSesionesCerradas(cerradas: number): string {
  const sesiones =
    cerradas === 1 ? '1 sesion abierta cerrada' : `${String(cerradas)} sesiones abiertas cerradas`;
  return `Contrasena cambiada. ${sesiones}.`;
}
