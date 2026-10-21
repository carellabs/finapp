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
 * El código de salida de un proceso de Windows al que le llega un Ctrl-C (STATUS_CONTROL_C_EXIT).
 * Windows no tiene señales entre procesos: el hijo no muere "por SIGINT", sale con este número y
 * `signal` queda en null. Medido con un Ctrl-C real (GenerateConsoleCtrlEvent) sobre un hijo de
 * `spawnSync`. En POSIX un código de salida nunca pasa de 255, así que no puede confundirse.
 */
export const STATUS_CTRL_C_WINDOWS = 0xc000013a;

/**
 * ¿Terminó el proceso de forma anormal? Un código de salida, sea cual sea, no lo es: lo decide quien
 * llama. Lo es: haber muerto por una señal (Ctrl-C, un tiempo agotado), no haberse podido lanzar o
 * haber desbordado el buffer (en todos esos casos `status` es null o hay `signal`/`error`), o, en
 * Windows, haber salido con el código del Ctrl-C (ver `STATUS_CTRL_C_WINDOWS`).
 * @param {{ status?: number | null, signal?: string | null, error?: Error }} resultado
 * @returns {boolean}
 */
export function fueInterrumpido(resultado) {
  return (
    resultado.error !== undefined ||
    (resultado.signal !== undefined && resultado.signal !== null) ||
    resultado.status === null ||
    resultado.status === undefined ||
    resultado.status === STATUS_CTRL_C_WINDOWS
  );
}

/**
 * Cómo se llamó el fallo de un resultado interrumpido, para el mensaje. El error manda sobre la
 * señal: al desbordar el buffer o agotar el tiempo, `spawnSync` mata al hijo con SIGTERM y el
 * resultado trae las dos cosas (`signal: 'SIGTERM'` y `error.code: 'ENOBUFS'`); la causa es el error.
 */
function causaDe(resultado) {
  if (resultado.error?.code === 'ENOBUFS') {
    return 'ENOBUFS (su salida desbordo el buffer)';
  }
  if (resultado.error?.code !== undefined) return resultado.error.code;
  if (resultado.status === STATUS_CTRL_C_WINDOWS) return 'Ctrl-C';
  return resultado.signal ?? 'sin codigo de salida';
}

/**
 * Con qué código termina un script cuyo hijo se interrumpió: 130 (128 + SIGINT) por un Ctrl-C,
 * 143 (128 + SIGTERM) por un SIGTERM y 1 por cualquier otra causa. Un error (ENOBUFS, ETIMEDOUT,
 * ENOENT) es siempre 1: `spawnSync` mata al hijo con SIGTERM al desbordar el buffer, y eso no es
 * que le hayan mandado un SIGTERM al script.
 * @param {{ status?: number | null, signal?: string | null, error?: Error }} resultado
 * @returns {number}
 */
export function codigoDeSalida(resultado) {
  if (resultado.error !== undefined) return 1;
  if (resultado.signal === 'SIGINT' || resultado.status === STATUS_CTRL_C_WINDOWS) return 130;
  if (resultado.signal === 'SIGTERM') return 143;
  return 1;
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
 * El envoltorio de cualquier proceso hijo: lo lanza (con un buffer grande) y, si muere por una señal
 * o desborda el buffer, llama a `alInterrumpir` con un mensaje y el resultado (el script lo usa para
 * limpiar y salir con `codigoDeSalida(resultado)`). Un código de salida normal, aunque no sea 0, se
 * devuelve tal cual. Un script SÍNCRONO no puede limpiar con `process.on('SIGINT')`: mientras
 * `spawnSync` espera, el manejador no corre; esto es lo que se entera de que el hijo murió.
 *
 * El mensaje nombra el comando y su primer argumento, nada más: los demás pueden llevar claves
 * (`docker run --env POSTGRES_PASSWORD=...`). `opciones.etiqueta` (no llega a `spawnSync`) lo
 * sustituye por el nombre del paso.
 * @param {(comando: string, argumentos: string[], opciones?: object) => any} lanzar
 * @param {(mensaje: string, resultado: object) => void} alInterrumpir
 * @returns {(comando: string, argumentos: string[], opciones?: object) => any}
 */
export function crearLanzador(lanzar, alInterrumpir) {
  return (comando, argumentos, opciones = {}) => {
    const { etiqueta, ...restantes } = opciones;
    const resultado = lanzar(comando, argumentos, { maxBuffer: MAX_BUFFER, ...restantes });
    if (fueInterrumpido(resultado)) {
      const paso = etiqueta ?? [comando, argumentos[0]].filter((x) => x !== undefined).join(' ');
      alInterrumpir(`${paso} no termino: ${causaDe(resultado)}.`, resultado);
    }
    return resultado;
  };
}

/**
 * El envoltorio de `docker`: como `crearLanzador`, con la salida en texto. Si el proceso muere por
 * una señal o desborda el buffer, llama a `alInterrumpir` con un mensaje.
 * @param {(comando: string, argumentos: string[], opciones?: object) => any} lanzar
 * @param {(mensaje: string) => void} alInterrumpir
 * @returns {(argumentos: string[], opciones?: object) => any}
 */
export function crearDocker(lanzar, alInterrumpir) {
  const lanzador = crearLanzador(lanzar, (mensaje) => alInterrumpir(mensaje));
  return (argumentos, opciones = {}) =>
    lanzador('docker', argumentos, { encoding: 'utf8', ...opciones });
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
