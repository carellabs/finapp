import { EventEmitter } from 'node:events';
import type { EntradaTerminal } from '../../src/infra/terminal';

/**
 * Una entrada y una salida de terminal FALSAS, para probar la lectura de contraseñas: lo que
 * importa es QUÉ se escribe en la salida (nada de lo tecleado) y cómo se deja el terminal (modo
 * normal, listeners fuera). Los códigos de control, con nombre: un byte de control literal en
 * el fuente es una invitación a errores de codificación al editarlo.
 */
export const CTRL_C = String.fromCharCode(3);
export const CTRL_D = String.fromCharCode(4);
export const BORRAR_DEL = String.fromCharCode(127);
export const BORRAR_BS = String.fromCharCode(8);
export const ESC = String.fromCharCode(27);
export const TAB = String.fromCharCode(9);

export interface EntradaFalsa extends EntradaTerminal {
  /** Orden de las llamadas de control (`raw:true`, `resume`, `pause`...). */
  readonly llamadas: string[];
  teclear(fragmento: string): void;
}

/** `llamadas` puede compartirse con la salida para ver en qué ORDEN ocurre todo. */
export function crearEntrada(esTty = true, llamadas: string[] = []): EntradaFalsa {
  const emisor = new EventEmitter();
  const entrada: EntradaFalsa = Object.assign(emisor, {
    isTTY: esTty,
    llamadas,
    setRawMode(modo: boolean) {
      llamadas.push(`raw:${String(modo)}`);
      return entrada;
    },
    resume() {
      llamadas.push('resume');
      return entrada;
    },
    pause() {
      llamadas.push('pause');
      return entrada;
    },
    setEncoding(codificacion: string) {
      llamadas.push(`encoding:${codificacion}`);
      return entrada;
    },
    teclear(fragmento: string) {
      emisor.emit('data', fragmento);
    },
  });
  return entrada;
}

export function crearSalida(orden: string[] = []) {
  const escrito: string[] = [];
  return {
    escrito,
    write(texto: string) {
      escrito.push(texto);
      orden.push(`escribe:${texto}`);
      return true;
    },
    todo: () => escrito.join(''),
  };
}
