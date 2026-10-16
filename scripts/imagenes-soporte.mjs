/**
 * Piezas de scripts/verificar-imagenes.mjs que deciden si un resultado de Docker o de psql vale,
 * aparte del script para poder probarlas (el script en sí necesita Docker y tarda minutos). Sin
 * dependencias de npm: el job `imagenes` de CI no instala nada.
 */

/**
 * Tope de lo que se captura de un proceso hijo. node-pg-migrate imprime el SQL de cada migración y
 * el valor por defecto de `spawnSync` (1 MiB) se queda corto: el proceso moriría con ENOBUFS.
 */
export const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * ¿Terminó el proceso de forma anormal? Un código de salida, sea cual sea, no lo es: lo decide quien
 * llama. Lo es: haber muerto por una señal (Ctrl-C, un tiempo agotado), no haberse podido lanzar o
 * haber desbordado el buffer (en todos esos casos `status` es null o hay `signal`/`error`).
 * @param {{ status?: number | null, signal?: string | null, error?: Error }} resultado
 * @returns {boolean}
 */
export function fueInterrumpido(resultado) {
  return (
    resultado.error !== undefined ||
    (resultado.signal !== undefined && resultado.signal !== null) ||
    resultado.status === null ||
    resultado.status === undefined
  );
}

/** Cómo se llamó el fallo de un resultado interrumpido, para el mensaje. */
function causaDe(resultado) {
  return resultado.signal ?? resultado.error?.code ?? 'sin codigo de salida';
}

/**
 * El número que devuelve una consulta de psql (`--tuples-only --no-align`). Falla, en vez de
 * devolver 0, si la consulta falló o no dio un entero: `Number('')` es 0, y una comprobación del
 * tipo `contar(...) === 0` ("no se creó ningún usuario") pasaba con psql roto.
 * @param {{ status?: number | null, signal?: string | null, error?: Error, stdout?: string }} resultado
 * @param {string} descripcion qué se contaba, para el mensaje
 * @returns {number}
 * @throws si la consulta falló, se interrumpió o su salida no es un entero no negativo. El mensaje
 *         no incluye la salida (podría llevar datos).
 */
export function numeroDeConsulta(resultado, descripcion) {
  if (fueInterrumpido(resultado)) {
    throw new Error(`La consulta «${descripcion}» se interrumpio (${causaDe(resultado)}).`);
  }
  if (resultado.status !== 0) {
    throw new Error(`La consulta «${descripcion}» fallo (codigo ${String(resultado.status)}).`);
  }
  const texto = (resultado.stdout ?? '').trim();
  if (!/^\d+$/.test(texto)) {
    throw new Error(`La consulta «${descripcion}» no devolvio un numero entero.`);
  }
  return Number(texto);
}

/**
 * El envoltorio de `docker`: lanza el comando (en texto, con un buffer grande) y, si el proceso
 * muere por una señal o desborda el buffer, llama a `alInterrumpir` con un mensaje (el script lo usa
 * para limpiar y salir). Un código de salida normal, aunque no sea 0, se devuelve tal cual.
 * @param {(comando: string, argumentos: string[], opciones?: object) => any} lanzar
 * @param {(mensaje: string) => void} alInterrumpir
 * @returns {(argumentos: string[], opciones?: object) => any}
 */
export function crearDocker(lanzar, alInterrumpir) {
  return (argumentos, opciones = {}) => {
    const resultado = lanzar('docker', argumentos, {
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      ...opciones,
    });
    if (fueInterrumpido(resultado)) {
      alInterrumpir(`docker ${argumentos.join(' ')} no termino: ${causaDe(resultado)}.`);
    }
    return resultado;
  };
}

/**
 * Espera `milisegundos` con un proceso de node (sin shell). Si lo corta una señal, avisa: seguir
 * esperando tras un Ctrl-C hacía que el script continuara como si nada.
 * @param {(comando: string, argumentos: string[], opciones?: object) => any} lanzar
 * @param {(mensaje: string) => void} alInterrumpir
 * @returns {(milisegundos: number) => void}
 */
export function crearDormir(lanzar, alInterrumpir) {
  return (milisegundos) => {
    const resultado = lanzar('node', ['-e', `setTimeout(()=>{},${String(milisegundos)})`], {
      stdio: 'ignore',
    });
    if (fueInterrumpido(resultado))
      alInterrumpir(`la espera se interrumpio: ${causaDe(resultado)}.`);
  };
}
