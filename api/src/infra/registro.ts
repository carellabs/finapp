import { serializarRegistro } from './redaccion';

/**
 * Registro estructurado de la API: una línea JSON por stderr. Es el ÚNICO sitio que
 * escribe en el log (ESLint prohíbe `console` en el resto de `src/`), y todo pasa por
 * `serializarRegistro`, que redacta por nombre de clave (cookies, autorización,
 * contraseñas, importes…): la protección no depende de que quien registra se acuerde.
 *
 * Aun así, los campos que se pasan son nombres de tarea, contadores y booleanos:
 * jamás valores de cabeceras, ids, tokens ni datos del usuario (security-engineering,
 * regla 8). La redacción es la red de seguridad, no el permiso para volcar.
 */
export interface EventoRegistro {
  readonly nivel: 'info' | 'warn' | 'error';
  readonly mensaje: string;
  readonly [campo: string]: string | number | boolean;
}

export type Registrar = (evento: EventoRegistro) => void;

/**
 * Cómo se describe un error en el log sin volcar datos: su tipo y, si lo hay, su
 * código (SQLSTATE de Postgres, errno de Node). Nunca el mensaje, que puede llevar
 * un importe, un nombre o el valor de una clave duplicada. Lo que no es un `Error`
 * no aporta nada.
 */
export function causaDeError(error: unknown): Record<string, string> {
  if (!(error instanceof Error)) return {};
  const causa: Record<string, string> = { error: error.name };
  const codigo = (error as { code?: unknown }).code;
  if (typeof codigo === 'string') causa.codigo = codigo;
  return causa;
}

export const registrarEnConsola: Registrar = (evento) => {
  console.error(serializarRegistro(evento));
};
