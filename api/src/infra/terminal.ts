import { createInterface } from 'node:readline';

/**
 * Entrada y salida de un script interactivo en un terminal. Todo recibe la entrada y la salida
 * por parámetro (en producción, `process.stdin` y `process.stdout`) para poder probarlo sin
 * terminal. Sin `console`: la salida es la que se le pasa.
 */

/** El usuario canceló (Ctrl-C, Ctrl-D) o la entrada se cerró antes de terminar de escribir. */
export class EntradaCancelada extends Error {
  constructor() {
    super('Entrada cancelada.');
    this.name = 'EntradaCancelada';
  }
}

/** La entrada no es un terminal: una contraseña no se acepta por tubería ni por redirección. */
export class EntradaNoInteractiva extends Error {
  constructor() {
    super('La entrada no es un terminal interactivo.');
    this.name = 'EntradaNoInteractiva';
  }
}

/**
 * Máximo de caracteres que acepta `leerOculto`. Muy por encima de cualquier contraseña real (el
 * login admite hasta 200): es un tope para que un pegado enorme no llene la memoria, no una
 * regla de contraseñas.
 */
export const LONGITUD_MAXIMA_ENTRADA = 1024;

/** Se tecleó o pegó más de `LONGITUD_MAXIMA_ENTRADA`. El mensaje no lleva lo escrito. */
export class EntradaDemasiadoLarga extends Error {
  constructor() {
    super(`La entrada supera los ${String(LONGITUD_MAXIMA_ENTRADA)} caracteres.`);
    this.name = 'EntradaDemasiadoLarga';
  }
}

/** Lo que se usa de `process.stdin` (y lo que una entrada falsa de un test tiene que ofrecer). */
export interface EntradaTerminal extends NodeJS.EventEmitter {
  readonly isTTY?: boolean;
  setRawMode?(modo: boolean): unknown;
  resume(): unknown;
  pause(): unknown;
  setEncoding(codificacion: BufferEncoding): unknown;
}

export interface SalidaTerminal {
  write(texto: string): unknown;
}

// Códigos de control como caracteres con nombre, no como escapes ni bytes literales en el
// fuente: evita cualquier ambigüedad de codificación al leer o editar este archivo.
const ENTER_CR = String.fromCharCode(13);
const ENTER_LF = String.fromCharCode(10);
const CTRL_C = String.fromCharCode(3);
const CTRL_D = String.fromCharCode(4);
const BORRAR_DEL = String.fromCharCode(127);
const BORRAR_BS = String.fromCharCode(8);
const ESC = String.fromCharCode(27);
const ESPACIO = ' ';

/**
 * Lee una línea que se ve mientras se escribe (el nombre de usuario). Si la entrada se cierra
 * antes de la línea (Ctrl-D, EOF), rechaza: sin esto la promesa quedaba colgada y el proceso
 * terminaba en silencio, con éxito, sin haber hecho nada.
 */
export function leerLinea(
  pregunta: string,
  entrada: NodeJS.ReadableStream,
  salida: NodeJS.WritableStream,
): Promise<string> {
  const lector = createInterface({ input: entrada, output: salida });
  return new Promise((resolver, rechazar) => {
    let respondida = false;
    lector.once('close', () => {
      if (!respondida) rechazar(new EntradaCancelada());
    });
    lector.question(pregunta, (respuesta) => {
      respondida = true;
      lector.close();
      resolver(respuesta);
    });
  });
}

type EstadoSecuencia = 'ninguna' | 'esc' | 'csi' | 'ss3';

/**
 * Una tecla especial (flechas, Supr, Inicio, F1...) llega como una secuencia que empieza por ESC,
 * y el terminal puede entregarla partida en varios fragmentos. Este autómata la sigue ENTRE
 * fragmentos y dice qué hacer con cada carácter:
 *  - ESC [ parámetros... y un byte final entre '@' y '~' (CSI: flechas, Supr, el pegado entre
 *    corchetes ESC[200~ y ESC[201~...). Se descarta entera: lo pegado ENTRE los marcadores del
 *    pegado sigue siendo la contraseña.
 *  - ESC O y un byte (SS3: F1 a F4 en algunos terminales). Se descarta entera.
 *  - ESC y otro carácter imprimible (Alt+tecla). Se descartan los dos.
 *  - Un carácter de control dentro de la secuencia (Enter, Ctrl-C, Ctrl-D...) la aborta y SE
 *    PROCESA: nunca se traga un Enter que ya llegó. Otro ESC empieza una secuencia nueva.
 * Un ESC solo, sin nada detrás en el mismo fragmento, deja la secuencia abierta: el siguiente
 * carácter se descarta como si fuera Alt+tecla.
 * @returns el estado siguiente y si el carácter se ha consumido (si no, hay que procesarlo)
 */
function avanzarSecuencia(
  estado: EstadoSecuencia,
  caracter: string,
): { estado: EstadoSecuencia; consumido: boolean } {
  if (caracter === ESC) return { estado: 'esc', consumido: true };
  if (estado === 'ninguna') return { estado, consumido: false };
  if (caracter < ESPACIO) return { estado: 'ninguna', consumido: false };

  if (estado === 'esc') {
    if (caracter === '[') return { estado: 'csi', consumido: true };
    if (caracter === 'O') return { estado: 'ss3', consumido: true };
    return { estado: 'ninguna', consumido: true };
  }
  if (estado === 'csi') {
    return { estado: caracter >= '@' && caracter <= '~' ? 'ninguna' : 'csi', consumido: true };
  }
  return { estado: 'ninguna', consumido: true };
}

/**
 * Lee una línea SIN eco: no escribe ni un carácter de lo tecleado (la pregunta y el salto de
 * línea final, sí). Exige un terminal de verdad (`isTTY`) y rechaza con `EntradaNoInteractiva`
 * si no lo es: sin terminal no hay forma de ocultar la entrada, y una contraseña que llega por
 * una tubería acaba en un historial, un fichero o el entorno de otro proceso.
 *
 * Lee en modo raw, así que gestiona ella misma el Enter, el borrado y la cancelación:
 *  - Enter (CR o LF) termina. Lo que venga detrás en el mismo fragmento se descarta.
 *  - Se procesa CARÁCTER A CARÁCTER: un gestor de contraseñas pega todo de golpe, en un solo
 *    fragmento, con su salto de línea incluido.
 *  - DEL y BS borran el último carácter (el último punto de código: un emoji no se parte).
 *  - Ctrl-C y Ctrl-D cancelan (en modo raw el terminal no genera SIGINT).
 *  - Las secuencias de escape se descartan enteras, vengan en un fragmento o en varios, sin
 *    comerse lo que hay detrás (ver `avanzarSecuencia`). Los demás caracteres de control se
 *    ignoran. Los espacios son contraseña.
 *  - Más de `LONGITUD_MAXIMA_ENTRADA` caracteres: se sigue CONSUMIENDO hasta el Enter (lo que
 *    quedara en el buffer del terminal acabaría en el shell de quien ejecuta) sin guardar nada, y
 *    se rechaza con `EntradaDemasiadoLarga`.
 *  - Si la entrada se cierra antes del Enter, cancela.
 * Al terminar, por cualquier camino, deja el terminal como estaba.
 */
export function leerOculto(
  pregunta: string,
  entrada: EntradaTerminal,
  salida: SalidaTerminal,
): Promise<string> {
  if (entrada.isTTY !== true || typeof entrada.setRawMode !== 'function') {
    return Promise.reject(new EntradaNoInteractiva());
  }
  const fijarModoRaw = (activo: boolean): void => {
    entrada.setRawMode?.(activo);
  };

  return new Promise((resolver, rechazar) => {
    const escritos: string[] = [];
    let secuencia: EstadoSecuencia = 'ninguna';
    let excedido = false;

    const terminar = (): void => {
      entrada.removeListener('data', alRecibir);
      entrada.removeListener('end', alCerrar);
      fijarModoRaw(false);
      entrada.pause();
      salida.write(ENTER_LF);
    };

    const alCerrar = (): void => {
      terminar();
      rechazar(new EntradaCancelada());
    };

    const alRecibir = (fragmento: string): void => {
      for (const caracter of fragmento) {
        const paso = avanzarSecuencia(secuencia, caracter);
        secuencia = paso.estado;
        if (paso.consumido) continue;

        if (caracter === ENTER_CR || caracter === ENTER_LF) {
          terminar();
          if (excedido) rechazar(new EntradaDemasiadoLarga());
          else resolver(escritos.join(''));
          return;
        }
        if (caracter === CTRL_C || caracter === CTRL_D) {
          terminar();
          rechazar(new EntradaCancelada());
          return;
        }
        if (excedido) continue;
        if (caracter === BORRAR_DEL || caracter === BORRAR_BS) {
          escritos.pop();
        } else if (caracter >= ESPACIO) {
          escritos.push(caracter);
          if (escritos.length > LONGITUD_MAXIMA_ENTRADA) {
            excedido = true;
            escritos.length = 0;
          }
        }
      }
    };

    // Raw ANTES de la pregunta: lo que se teclee en cuanto aparece (un gestor de contraseñas
    // que escribe al ver el aviso) ya no lo repite el eco del terminal.
    fijarModoRaw(true);
    salida.write(pregunta);
    entrada.setEncoding('utf8');
    entrada.resume();
    entrada.on('data', alRecibir);
    entrada.on('end', alCerrar);
  });
}
