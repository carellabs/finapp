/**
 * Registro estructurado de eventos que no nacen de una petición HTTP (las
 * tareas periódicas). Una línea JSON por stderr, igual que el resto de la API.
 *
 * Los campos son nombres de tarea, contadores y booleanos: jamás valores de
 * cabeceras, ids, tokens ni datos del usuario (security-engineering, regla 8).
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
  console.error(JSON.stringify(evento));
};
