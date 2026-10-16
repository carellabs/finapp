import { describe, expect, it, vi } from 'vitest';
import { altaUsuario, describirFallo, type DependenciasAlta } from '../../src/auth/alta-usuario';
import {
  EntradaDemasiadoLarga,
  LONGITUD_MAXIMA_ENTRADA,
  leerOculto,
} from '../../src/infra/terminal';
import { ESC, crearEntrada, crearSalida } from '../soporte/terminal-falso';

/**
 * El alta de usuario con el lector REAL de contraseñas (`leerOculto`) sobre un terminal falso:
 * lo que cada pieza promete por separado, junto. Las dos preguntas ocultas leen de la misma
 * entrada; el test teclea cuando el lector ya está escuchando.
 */
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$sal-de-prueba$hash-de-prueba';

function montar() {
  const entrada = crearEntrada();
  const salidaTerminal = crearSalida();
  const salida: string[] = [];
  const hashear = vi.fn((_contrasena: string) => Promise.resolve(HASH));
  const guardar = vi.fn((_nombre: string, _hash: string) => Promise.resolve());
  const deps: DependenciasAlta = {
    esInteractivo: true,
    preguntar: () => Promise.resolve('ana'),
    preguntarOculto: (pregunta) => leerOculto(pregunta, entrada, salidaTerminal),
    hashear,
    guardar,
    escribir: (linea) => salida.push(linea),
  };

  /** Teclea cuando el lector ya escucha (la pregunta anterior ya terminó). */
  const teclear = async (texto: string): Promise<void> => {
    await vi.waitFor(() => expect(entrada.listenerCount('data')).toBe(1));
    entrada.teclear(texto);
  };
  return { deps, teclear, salida, salidaTerminal, hashear, guardar };
}

describe('altaUsuario con leerOculto', () => {
  it('lo que se teclea con espacios y teclas especiales por medio llega entero al hash', async () => {
    const { deps, teclear, hashear, guardar } = montar();
    const alta = altaUsuario(deps);

    // Una flecha en medio de la contraseña, con sus espacios, y el Enter en el mismo fragmento.
    await teclear(`con ${ESC}[Despacios 123\r`);
    await teclear(`con ${ESC}[Despacios 123\r`);
    await alta;

    expect(hashear).toHaveBeenCalledExactlyOnceWith('con espacios 123');
    expect(guardar).toHaveBeenCalledExactlyOnceWith('ana', HASH);
  });

  it(`una contraseña pegada de más de ${LONGITUD_MAXIMA_ENTRADA} caracteres se rechaza: ni hash, ni guardado, ni rastro en la salida`, async () => {
    const { deps, teclear, hashear, guardar, salida, salidaTerminal } = montar();
    const alta = altaUsuario(deps);
    const rechazo = alta.catch((error: unknown) => error);

    await teclear(`${'clave-enorme-'.repeat(200)}\r`);
    const error = await rechazo;

    expect(error).toBeInstanceOf(EntradaDemasiadoLarga);
    expect(hashear).not.toHaveBeenCalled();
    expect(guardar).not.toHaveBeenCalled();
    expect(salida).toEqual([]);
    expect(salidaTerminal.todo()).not.toContain('clave-enorme');
    // Y el script lo cuenta sin volcar lo pegado, con un código de fallo.
    const fallo = describirFallo(error);
    expect(fallo.codigo).toBe(1);
    expect(fallo.mensaje).toContain(String(LONGITUD_MAXIMA_ENTRADA));
    expect(fallo.mensaje).not.toContain('clave-enorme');
  });
});
