import { describe, expect, it } from 'vitest';
import {
  EntradaCancelada,
  EntradaDemasiadoLarga,
  LONGITUD_MAXIMA_ENTRADA,
  leerOculto,
} from '../../src/infra/terminal';
import {
  BORRAR_DEL,
  CTRL_C,
  CTRL_D,
  ESC,
  crearEntrada,
  crearSalida,
} from '../soporte/terminal-falso';

/**
 * Secuencias de escape y tope de longitud de `leerOculto`. Las teclas especiales (flechas,
 * Supr, Inicio...) llegan como una secuencia que empieza por ESC; el terminal puede entregarla
 * partida en varios fragmentos y la persona (o su gestor de contraseñas) puede pegar texto
 * detrás de ella, Enter incluido. Tirar el resto del fragmento al ver un ESC dejaba el script
 * esperando para siempre un Enter que ya había llegado.
 */
describe('leerOculto: secuencias de escape (máquina de estados entre fragmentos)', () => {
  const lector = () => {
    const entrada = crearEntrada();
    return { entrada, lectura: leerOculto('x: ', entrada, crearSalida()) };
  };

  it('una flecha en medio del fragmento no se come el resto ni el Enter', async () => {
    const { entrada, lectura } = lector();

    entrada.teclear(`abcd${ESC}[Defgh\r`);

    await expect(lectura).resolves.toBe('abcdefgh');
  });

  it('una secuencia partida en varios fragmentos se descarta entera', async () => {
    const { entrada, lectura } = lector();

    entrada.teclear(`ab${ESC}`);
    entrada.teclear('[');
    entrada.teclear('3~cd\r');

    await expect(lectura).resolves.toBe('abcd');
  });

  it('Supr (ESC [ 3 ~) con un espacio detrás: el espacio se conserva', async () => {
    const { entrada, lectura } = lector();

    entrada.teclear(`a${ESC}[3~ b\r`);

    await expect(lectura).resolves.toBe('a b');
  });

  it('un ESC suelto seguido de Enter en el mismo fragmento: el Enter termina', async () => {
    const { entrada, lectura } = lector();

    entrada.teclear(`ab${ESC}\r`);

    await expect(lectura).resolves.toBe('ab');
  });

  it('Alt+tecla (ESC x) se descarta entera', async () => {
    const { entrada, lectura } = lector();

    entrada.teclear(`ab${ESC}xcd\r`);

    await expect(lectura).resolves.toBe('abcd');
  });

  it('una flecha seguida de Ctrl-C en el mismo fragmento cancela', async () => {
    const { entrada, lectura } = lector();

    entrada.teclear(`${ESC}[A${CTRL_C}`);

    await expect(lectura).rejects.toBeInstanceOf(EntradaCancelada);
  });

  it('una flecha seguida de Ctrl-D en el mismo fragmento cancela', async () => {
    const { entrada, lectura } = lector();

    entrada.teclear(`ab${ESC}[B${CTRL_D}`);

    await expect(lectura).rejects.toBeInstanceOf(EntradaCancelada);
  });

  it('una secuencia con parámetros (Ctrl-Derecha, ESC [ 1 ; 5 C) se descarta entera', async () => {
    const { entrada, lectura } = lector();

    entrada.teclear(`a${ESC}[1;5Cb\r`);

    await expect(lectura).resolves.toBe('ab');
  });

  it('una tecla de función SS3 (ESC O P) se descarta entera', async () => {
    const { entrada, lectura } = lector();

    entrada.teclear(`a${ESC}OPb\r`);

    await expect(lectura).resolves.toBe('ab');
  });

  it('una secuencia abortada por un Enter (ESC [ y Enter) no se traga el Enter', async () => {
    const { entrada, lectura } = lector();

    entrada.teclear(`ab${ESC}[\r`);

    await expect(lectura).resolves.toBe('ab');
  });

  it('un ESC y otro ESC seguidos: el segundo empieza una secuencia nueva', async () => {
    const { entrada, lectura } = lector();

    entrada.teclear(`a${ESC}${ESC}[Ab\r`);

    await expect(lectura).resolves.toBe('ab');
  });

  it('el pegado entre corchetes (ESC[200~ ... ESC[201~) no descarta la contraseña pegada', async () => {
    const { entrada, lectura } = lector();

    entrada.teclear(`${ESC}[200~con espacios 123${ESC}[201~\r`);

    await expect(lectura).resolves.toBe('con espacios 123');
  });

  it('el pegado entre corchetes también funciona partido en fragmentos', async () => {
    const { entrada, lectura } = lector();

    entrada.teclear(`${ESC}[20`);
    entrada.teclear('0~clave-pegada');
    entrada.teclear(`${ESC}[201`);
    entrada.teclear('~\r');

    await expect(lectura).resolves.toBe('clave-pegada');
  });

  it('el estado de la secuencia no sobrevive a la lectura: la siguiente empieza limpia', async () => {
    const primera = lector();
    primera.entrada.teclear(`a${ESC}`);
    primera.entrada.teclear(CTRL_C);
    await expect(primera.lectura).rejects.toBeInstanceOf(EntradaCancelada);

    const { entrada, lectura } = lector();
    entrada.teclear('bc\r');

    await expect(lectura).resolves.toBe('bc');
  });
});

describe('leerOculto: tope de longitud', () => {
  const lector = () => {
    const entrada = crearEntrada();
    const salida = crearSalida();
    return { entrada, salida, lectura: leerOculto('x: ', entrada, salida) };
  };

  it('el tope es de 1024 caracteres', () => {
    expect(LONGITUD_MAXIMA_ENTRADA).toBe(1024);
  });

  it('acepta exactamente el máximo de caracteres', async () => {
    const { entrada, lectura } = lector();

    entrada.teclear(`${'a'.repeat(LONGITUD_MAXIMA_ENTRADA)}\r`);

    await expect(lectura).resolves.toHaveLength(LONGITUD_MAXIMA_ENTRADA);
  });

  it('con un carácter más rechaza al Enter, sin eco y sin devolver nada', async () => {
    const { entrada, salida, lectura } = lector();

    entrada.teclear(`${'a'.repeat(LONGITUD_MAXIMA_ENTRADA + 1)}\r`);

    await expect(lectura).rejects.toBeInstanceOf(EntradaDemasiadoLarga);
    expect(salida.escrito).toEqual(['x: ', '\n']);
    expect(entrada.listenerCount('data')).toBe(0);
    expect(entrada.llamadas.at(-2)).toBe('raw:false');
  });

  it('un pegado enorme se sigue CONSUMIENDO hasta el Enter (no queda en el buffer del terminal)', async () => {
    // Si se dejara de leer al pasarse, el resto del pegado acabaría en el shell de quien ejecuta
    // el script, que lo mostraría o lo ejecutaría.
    const { entrada, lectura } = lector();
    let rechazada = false;
    lectura.catch(() => {
      rechazada = true;
    });

    entrada.teclear('a'.repeat(100_000));
    await Promise.resolve();
    expect(rechazada).toBe(false);
    expect(entrada.listenerCount('data')).toBe(1);

    entrada.teclear(`${'b'.repeat(100_000)}\r`);

    await expect(lectura).rejects.toBeInstanceOf(EntradaDemasiadoLarga);
    expect(entrada.listenerCount('data')).toBe(0);
  });

  it('pasado el tope, Ctrl-C sigue cancelando (y es una cancelación, no un exceso)', async () => {
    const { entrada, lectura } = lector();

    entrada.teclear('a'.repeat(LONGITUD_MAXIMA_ENTRADA + 5));
    entrada.teclear(CTRL_C);

    await expect(lectura).rejects.toBeInstanceOf(EntradaCancelada);
  });

  it('pasado el tope, si la entrada se cierra también es una cancelación', async () => {
    const { entrada, lectura } = lector();

    entrada.teclear('a'.repeat(LONGITUD_MAXIMA_ENTRADA + 5));
    entrada.emit('end');

    await expect(lectura).rejects.toBeInstanceOf(EntradaCancelada);
  });

  it('los borrados no alivian un exceso ya producido', async () => {
    const { entrada, lectura } = lector();

    entrada.teclear('a'.repeat(LONGITUD_MAXIMA_ENTRADA + 1) + BORRAR_DEL.repeat(500));
    entrada.teclear('\r');

    await expect(lectura).rejects.toBeInstanceOf(EntradaDemasiadoLarga);
  });

  it('los borrados antes de pasarse sí cuentan: se puede teclear más del máximo en total', async () => {
    const { entrada, lectura } = lector();

    entrada.teclear('a'.repeat(LONGITUD_MAXIMA_ENTRADA));
    entrada.teclear(`${BORRAR_DEL.repeat(10)}${'b'.repeat(10)}\r`);

    await expect(lectura).resolves.toHaveLength(LONGITUD_MAXIMA_ENTRADA);
  });

  it('el mensaje del error dice el máximo y no contiene lo tecleado', async () => {
    const { entrada, lectura } = lector();

    entrada.teclear(`${'clave-larga-'.repeat(200)}\r`);

    const error = (await lectura.catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(EntradaDemasiadoLarga);
    expect(error.message).not.toContain('clave-larga');
    expect(error.message).toContain(String(LONGITUD_MAXIMA_ENTRADA));
  });

  it('una secuencia de escape no cuenta para el tope', async () => {
    const { entrada, lectura } = lector();

    entrada.teclear('a'.repeat(LONGITUD_MAXIMA_ENTRADA - 1));
    entrada.teclear(`${ESC}[1;5C${ESC}[200~b${ESC}[201~\r`);

    await expect(lectura).resolves.toHaveLength(LONGITUD_MAXIMA_ENTRADA);
  });
});
