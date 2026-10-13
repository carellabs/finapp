const URL_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';

export interface DetalleCampoApi {
  campo: string;
  motivo: string;
}

export interface ErrorApi {
  codigo: string;
  mensaje: string;
  requestId?: string;
  detalles?: DetalleCampoApi[];
}

/** Único punto de la app que conoce el sobre `{data}`/`{error}` del backend. */
export class ErrorPeticion extends Error {
  readonly status: number;
  readonly codigo: string;
  readonly detalles: DetalleCampoApi[];

  constructor(status: number, error: ErrorApi) {
    super(error.mensaje);
    this.status = status;
    this.codigo = error.codigo;
    this.detalles = error.detalles ?? [];
  }
}

interface OpcionesPeticion {
  metodo?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  cuerpo?: unknown;
  query?: Record<string, string | undefined>;
}

async function peticion<T>(ruta: string, opciones: OpcionesPeticion = {}): Promise<T> {
  const url = new URL(URL_BASE.replace(/\/$/, '') + ruta);
  for (const [clave, valor] of Object.entries(opciones.query ?? {})) {
    if (valor !== undefined) url.searchParams.set(clave, valor);
  }

  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      method: opciones.metodo ?? 'GET',
      // Cookie de sesión httpOnly: sin esto, ninguna petición autenticada funciona.
      credentials: 'include',
      // `exactOptionalPropertyTypes`: `body`/`headers` se OMITEN por completo
      // cuando no hay cuerpo, nunca se les asigna `undefined` explícito.
      ...(opciones.cuerpo === undefined
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(opciones.cuerpo),
          }),
    });
  } catch {
    throw new ErrorPeticion(0, {
      codigo: 'SIN_CONEXION',
      mensaje: 'No se pudo conectar con el servidor',
    });
  }

  if (respuesta.status === 204) return undefined as T;

  let cuerpoJson: unknown;
  try {
    cuerpoJson = await respuesta.json();
  } catch {
    throw new ErrorPeticion(respuesta.status, {
      codigo: 'RESPUESTA_INVALIDA',
      mensaje: 'El servidor devolvió una respuesta inesperada',
    });
  }

  if (!respuesta.ok) {
    throw new ErrorPeticion(respuesta.status, (cuerpoJson as { error: ErrorApi }).error);
  }

  return (cuerpoJson as { data: T }).data;
}

export const apiCliente = {
  get: <T>(ruta: string, query?: Record<string, string | undefined>): Promise<T> =>
    peticion<T>(ruta, query === undefined ? {} : { query }),
  post: <T>(ruta: string, cuerpo?: unknown): Promise<T> =>
    peticion<T>(ruta, { metodo: 'POST', cuerpo }),
  patch: <T>(ruta: string, cuerpo?: unknown): Promise<T> =>
    peticion<T>(ruta, { metodo: 'PATCH', cuerpo }),
  put: <T>(ruta: string, cuerpo?: unknown): Promise<T> =>
    peticion<T>(ruta, { metodo: 'PUT', cuerpo }),
  eliminar: <T>(ruta: string): Promise<T> => peticion<T>(ruta, { metodo: 'DELETE' }),
};
