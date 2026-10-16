import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  EntradaCancelada,
  EntradaNoInteractiva,
  leerLinea,
  leerOculto,
} from '../../src/infra/terminal';
import {
  BORRAR_BS,
  BORRAR_DEL,
  CTRL_C,
  CTRL_D,
  ESC,
  TAB,
  crearEntrada,
  crearSalida,
} from '../soporte/terminal-falso';

/**
 * Lectura de una contraseña en un terminal: sin eco, sin aceptar tuberías. Se prueba con una
 * entrada y una salida falsas (tests/soporte/terminal-falso.ts). Las secuencias de escape y el
 * tope de longitud, en terminal-escape.test.ts.
 */
describe('leerOculto', () => {
  it('devuelve lo tecleado y no escribe NADA de ello en la salida (sin eco)', async () => {
    const entrada = crearEntrada();
    const salida = crearSalida();
    const lectura = leerOculto('Contrasena: ', entrada, salida);

    for (const letra of ['s', 'e', 'c', 'r', 'e', 't', 'o']) entrada.teclear(letra);
    entrada.teclear('\r');

    await expect(lectura).resolves.toBe('secreto');
    // La pregunta y el salto de línea del Enter: nada más. Ni una letra de la contraseña.
    expect(salida.escrito).toEqual(['Contrasena: ', '\n']);
  });

  it('pone el terminal en modo raw mientras lee y lo restaura al terminar, sin dejar listeners', async () => {
    const entrada = crearEntrada();
    const lectura = leerOculto('x: ', entrada, crearSalida());

    expect(entrada.llamadas).toContain('raw:true');
    // Texto UTF-8 (no bytes: un carácter de varios bytes no puede llegar partido) y entrada en marcha.
    expect(entrada.llamadas).toContain('encoding:utf8');
    expect(entrada.llamadas).toContain('resume');
    expect(entrada.listenerCount('data')).toBe(1);
    expect(entrada.listenerCount('end')).toBe(1);

    entrada.teclear('a\n');
    await lectura;

    expect(entrada.llamadas.at(-2)).toBe('raw:false');
    expect(entrada.llamadas.at(-1)).toBe('pause');
    expect(entrada.listenerCount('data')).toBe(0);
    expect(entrada.listenerCount('end')).toBe(0);
  });

  it('activa el modo raw ANTES de escribir la pregunta: lo que se teclee en cuanto aparece no hace eco', async () => {
    // Si la pregunta saliera primero, un gestor de contraseñas que escribe al ver el aviso (o
    // una persona rápida) tendría su contraseña repetida en pantalla por el eco del terminal.
    const orden: string[] = [];
    const entrada = crearEntrada(true, orden);
    const lectura = leerOculto('Contrasena: ', entrada, crearSalida(orden));

    expect(orden.indexOf('raw:true')).toBeGreaterThanOrEqual(0);
    expect(orden.indexOf('raw:true')).toBeLessThan(orden.indexOf('escribe:Contrasena: '));

    entrada.teclear('a\r');
    await lectura;
  });

  it.each([['\r'], ['\n'], ['\r\n']])(
    'una contraseña PEGADA de golpe con su salto de línea (%j) se lee entera',
    async (final) => {
      // Un gestor de contraseñas pega todo en un solo fragmento: no puede mirarse solo el
      // primer carácter del fragmento (la contraseña no acababa nunca).
      const entrada = crearEntrada();
      const lectura = leerOculto('x: ', entrada, crearSalida());

      entrada.teclear(`pegada-1234${final}`);

      await expect(lectura).resolves.toBe('pegada-1234');
    },
  );

  it('lo que llega después del Enter, en el mismo fragmento, no forma parte de la contraseña', async () => {
    const entrada = crearEntrada();
    const lectura = leerOculto('x: ', entrada, crearSalida());

    entrada.teclear('abc\rresto');

    await expect(lectura).resolves.toBe('abc');
  });

  it.each([
    ['DEL', BORRAR_DEL],
    ['BS', BORRAR_BS],
  ])('%s borra el último carácter', async (_nombre, borrar) => {
    const entrada = crearEntrada();
    const lectura = leerOculto('x: ', entrada, crearSalida());

    entrada.teclear(`abcd${borrar}${borrar}`);
    entrada.teclear('X\r');

    await expect(lectura).resolves.toBe('abX');
  });

  it('borrar un carácter fuera del plano básico (emoji) lo quita entero, no media pareja', async () => {
    const entrada = crearEntrada();
    const lectura = leerOculto('x: ', entrada, crearSalida());

    entrada.teclear(`ab\u{1F600}${BORRAR_DEL}\r`);

    await expect(lectura).resolves.toBe('ab');
  });

  it('borrar con la contraseña vacía no falla ni borra más de lo que hay', async () => {
    const entrada = crearEntrada();
    const lectura = leerOculto('x: ', entrada, crearSalida());

    entrada.teclear(`${BORRAR_DEL}${BORRAR_DEL}z\r`);

    await expect(lectura).resolves.toBe('z');
  });

  it('un fragmento con secuencia de escape (flechas) se ignora: no se cuela en la contraseña', async () => {
    const entrada = crearEntrada();
    const lectura = leerOculto('x: ', entrada, crearSalida());

    entrada.teclear('ab');
    entrada.teclear(`${ESC}[A`);
    entrada.teclear('cd\r');

    await expect(lectura).resolves.toBe('abcd');
  });

  it('los demás caracteres de control (tabulador) se ignoran', async () => {
    const entrada = crearEntrada();
    const lectura = leerOculto('x: ', entrada, crearSalida());

    entrada.teclear(`a${TAB}b\r`);

    await expect(lectura).resolves.toBe('ab');
  });

  it.each([
    ['en medio', 'a b c', 'a b c'],
    ['al principio y al final', '  x  ', '  x  '],
    ['solo espacios', '    ', '    '],
  ])('conserva los espacios de la contraseña (%s)', async (_donde, tecleado, esperado) => {
    // El espacio es el primer carácter imprimible (0x20): `>` en vez de `>=` los descartaba.
    const entrada = crearEntrada();
    const lectura = leerOculto('x: ', entrada, crearSalida());

    entrada.teclear(`${tecleado}\r`);

    await expect(lectura).resolves.toBe(esperado);
  });

  it.each([
    ['Ctrl-C', CTRL_C],
    ['Ctrl-D', CTRL_D],
  ])('%s cancela: rechaza, restaura el terminal y no escribe lo tecleado', async (_n, tecla) => {
    const entrada = crearEntrada();
    const salida = crearSalida();
    const lectura = leerOculto('x: ', entrada, salida);

    entrada.teclear('sec');
    entrada.teclear(tecla);

    await expect(lectura).rejects.toBeInstanceOf(EntradaCancelada);
    expect(entrada.llamadas).toContain('raw:false');
    expect(entrada.listenerCount('data')).toBe(0);
    expect(salida.todo()).toBe('x: \n');
  });

  it('si la entrada se cierra antes del Enter, rechaza en vez de quedarse esperando', async () => {
    const entrada = crearEntrada();
    const lectura = leerOculto('x: ', entrada, crearSalida());

    entrada.teclear('par');
    entrada.emit('end');

    await expect(lectura).rejects.toBeInstanceOf(EntradaCancelada);
    expect(entrada.llamadas).toContain('raw:false');
    expect(entrada.listenerCount('data')).toBe(0);
  });

  it('si dice ser un terminal pero no puede quitar el eco (sin setRawMode), rechaza: nunca lee con eco', async () => {
    const entrada = crearEntrada(true);
    Reflect.deleteProperty(entrada, 'setRawMode');
    const salida = crearSalida();

    await expect(leerOculto('x: ', entrada, salida)).rejects.toBeInstanceOf(EntradaNoInteractiva);

    expect(entrada.listenerCount('data')).toBe(0);
    expect(salida.escrito).toEqual([]);
  });

  it('si la entrada NO es un terminal, rechaza sin leer nada ni escribir la pregunta', async () => {
    const entrada = crearEntrada(false);
    const salida = crearSalida();

    await expect(leerOculto('x: ', entrada, salida)).rejects.toBeInstanceOf(EntradaNoInteractiva);

    expect(entrada.listenerCount('data')).toBe(0);
    expect(entrada.llamadas).toEqual([]);
    expect(salida.escrito).toEqual([]);
  });
});

describe('leerLinea', () => {
  it('escribe la pregunta, lee una línea y la devuelve sin el salto', async () => {
    const entrada = new PassThrough();
    const salida = new PassThrough();
    const escrito: string[] = [];
    salida.on('data', (trozo: Buffer) => escrito.push(trozo.toString()));

    const lectura = leerLinea('Nombre de usuario: ', entrada, salida);
    entrada.write('ana\n');

    await expect(lectura).resolves.toBe('ana');
    expect(escrito.join('')).toBe('Nombre de usuario: ');
  });

  it('si la entrada se cierra sin línea, rechaza en vez de dejar la promesa colgada', async () => {
    const entrada = new PassThrough();
    const salida = new PassThrough();

    const lectura = leerLinea('x: ', entrada, salida);
    entrada.end();

    await expect(lectura).rejects.toBeInstanceOf(EntradaCancelada);
  });
});
