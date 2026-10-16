import { describe, expect, it, vi } from 'vitest';
import {
  altaUsuario,
  describirFallo,
  ErrorAltaUsuario,
  type DependenciasAlta,
} from '../../src/auth/alta-usuario';
import { EntradaCancelada } from '../../src/infra/terminal';

/**
 * Alta del usuario por terminal. La contraseña es el dato que más importa no filtrar: estos
 * tests vigilan que solo se pide en un terminal, sin eco, dos veces, y que no aparece ni en la
 * salida, ni en los errores, ni se guarda más que como hash.
 */
const CONTRASENA = 'Sentinela-Contrasena-8841';
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$sal-de-prueba$hash-de-prueba';

interface Montaje {
  readonly deps: DependenciasAlta;
  readonly salida: string[];
  readonly preguntar: ReturnType<typeof vi.fn<(pregunta: string) => Promise<string>>>;
  readonly preguntarOculto: ReturnType<typeof vi.fn<(pregunta: string) => Promise<string>>>;
  readonly hashear: ReturnType<typeof vi.fn<(contrasena: string) => Promise<string>>>;
  readonly guardar: ReturnType<typeof vi.fn<(nombre: string, hash: string) => Promise<void>>>;
}

/** Un alta con `usuario` y las contraseñas que se teclean (la 1.ª y su repetición). */
function montar(
  opciones: { usuario?: string; contrasenas?: string[]; esInteractivo?: boolean } = {},
): Montaje {
  const {
    usuario = 'ana',
    contrasenas = [CONTRASENA, CONTRASENA],
    esInteractivo = true,
  } = opciones;
  const salida: string[] = [];
  const pendientes = [...contrasenas];
  const preguntar = vi.fn((_pregunta: string) => Promise.resolve(usuario));
  const preguntarOculto = vi.fn((_pregunta: string) => Promise.resolve(pendientes.shift() ?? ''));
  const hashear = vi.fn((_contrasena: string) => Promise.resolve(HASH));
  const guardar = vi.fn((_nombre: string, _hash: string) => Promise.resolve());
  const deps: DependenciasAlta = {
    esInteractivo,
    preguntar,
    preguntarOculto,
    hashear,
    guardar,
    escribir: (linea) => salida.push(linea),
  };
  return { deps, salida, preguntar, preguntarOculto, hashear, guardar };
}

/** Lo que devuelve el alta si falla: el error, para mirar su mensaje. */
async function falla(montaje: Montaje): Promise<Error> {
  try {
    await altaUsuario(montaje.deps);
  } catch (error) {
    return error as Error;
  }
  throw new Error('Se esperaba que el alta fallase, pero terminó bien');
}

describe('altaUsuario: sin terminal no se pide ni se crea nada', () => {
  it('si la entrada no es un terminal, falla con un mensaje claro y no pregunta, no hashea y no guarda', async () => {
    const montaje = montar({ esInteractivo: false });

    const error = await falla(montaje);

    expect(error).toBeInstanceOf(ErrorAltaUsuario);
    expect(error.message).toMatch(/terminal interactiva/i);
    expect(error.message).toMatch(/tuberia|redirig/i);
    expect(montaje.preguntar).not.toHaveBeenCalled();
    expect(montaje.preguntarOculto).not.toHaveBeenCalled();
    expect(montaje.hashear).not.toHaveBeenCalled();
    expect(montaje.guardar).not.toHaveBeenCalled();
    expect(montaje.salida).toEqual([]);
  });

  it('control positivo: con terminal, el mismo montaje sí guarda', async () => {
    const montaje = montar({ esInteractivo: true });

    await altaUsuario(montaje.deps);

    expect(montaje.guardar).toHaveBeenCalledTimes(1);
  });
});

describe('altaUsuario: camino feliz', () => {
  it('pide el usuario a la vista y la contraseña dos veces, SIEMPRE oculta', async () => {
    const montaje = montar();

    await altaUsuario(montaje.deps);

    // Un solo `preguntar` (el nombre) y dos `preguntarOculto` (contraseña y repetición): la
    // contraseña no puede pedirse nunca con la pregunta que hace eco.
    expect(montaje.preguntar).toHaveBeenCalledTimes(1);
    expect(montaje.preguntar.mock.calls[0]?.[0]).toMatch(/usuario/i);
    expect(montaje.preguntarOculto).toHaveBeenCalledTimes(2);
  });

  it('hashea la contraseña tal cual (sin recortar espacios) y guarda el hash, nunca la contraseña', async () => {
    const conEspacios = '  espacios al borde 123  ';
    const montaje = montar({ contrasenas: [conEspacios, conEspacios] });

    await altaUsuario(montaje.deps);

    expect(montaje.hashear).toHaveBeenCalledExactlyOnceWith(conEspacios);
    expect(montaje.guardar).toHaveBeenCalledExactlyOnceWith('ana', HASH);
    const guardado = JSON.stringify(montaje.guardar.mock.calls);
    expect(guardado).not.toContain('espacios al borde');
  });

  it('recorta el nombre de usuario', async () => {
    const montaje = montar({ usuario: '  ana  ' });

    await altaUsuario(montaje.deps);

    expect(montaje.guardar).toHaveBeenCalledExactlyOnceWith('ana', HASH);
  });

  it('confirma por la salida el nombre, pero ni la contraseña ni el hash', async () => {
    const montaje = montar();

    await altaUsuario(montaje.deps);

    const salida = montaje.salida.join('\n');
    expect(salida).toContain('ana');
    expect(salida).not.toContain(CONTRASENA);
    expect(salida).not.toContain(HASH);
    expect(salida).not.toContain('argon2');
  });
});

describe('altaUsuario: validaciones (no crean nada)', () => {
  it('las dos contraseñas distintas: falla, no hashea ni guarda, y el error no las vuelca', async () => {
    const montaje = montar({ contrasenas: [CONTRASENA, `${CONTRASENA}-otra`] });

    const error = await falla(montaje);

    expect(error).toBeInstanceOf(ErrorAltaUsuario);
    expect(error.message).toMatch(/no coinciden/i);
    expect(error.message).not.toContain(CONTRASENA);
    expect(montaje.hashear).not.toHaveBeenCalled();
    expect(montaje.guardar).not.toHaveBeenCalled();
  });

  it('un nombre vacío (o solo espacios) falla antes de pedir la contraseña', async () => {
    const montaje = montar({ usuario: '   ' });

    const error = await falla(montaje);

    expect(error.message).toMatch(/nombre de usuario/i);
    expect(montaje.preguntarOculto).not.toHaveBeenCalled();
    expect(montaje.guardar).not.toHaveBeenCalled();
  });

  it('un nombre de más de 100 caracteres falla: el login no lo aceptaría', async () => {
    const montaje = montar({ usuario: 'a'.repeat(101) });

    const error = await falla(montaje);

    expect(error.message).toMatch(/nombre de usuario/i);
    expect(montaje.guardar).not.toHaveBeenCalled();
  });

  it('acepta un nombre de exactamente 100 caracteres', async () => {
    const montaje = montar({ usuario: 'a'.repeat(100) });

    await altaUsuario(montaje.deps);

    expect(montaje.guardar).toHaveBeenCalledTimes(1);
  });

  it('una contraseña de 7 caracteres (una menos que el mínimo) falla antes de pedir la repetición', async () => {
    const corta = 'a'.repeat(7);
    const montaje = montar({ contrasenas: [corta, corta] });

    const error = await falla(montaje);

    expect(error.message).toContain('8');
    expect(error.message).not.toContain(corta);
    expect(montaje.preguntarOculto).toHaveBeenCalledTimes(1);
    expect(montaje.guardar).not.toHaveBeenCalled();
  });

  it('acepta una contraseña de exactamente 8 caracteres (el mínimo)', async () => {
    const justa = 'a'.repeat(8);
    const montaje = montar({ contrasenas: [justa, justa] });

    await altaUsuario(montaje.deps);

    expect(montaje.guardar).toHaveBeenCalledTimes(1);
  });

  it('una contraseña de más de 200 caracteres falla: el login no la aceptaría y el usuario no podría entrar', async () => {
    const larga = 'a'.repeat(201);
    const montaje = montar({ contrasenas: [larga, larga] });

    const error = await falla(montaje);

    expect(error.message).toContain('200');
    expect(error.message).not.toContain(larga);
    expect(montaje.guardar).not.toHaveBeenCalled();
  });

  it('acepta una contraseña de exactamente 200 caracteres', async () => {
    const justa = 'a'.repeat(200);
    const montaje = montar({ contrasenas: [justa, justa] });

    await altaUsuario(montaje.deps);

    expect(montaje.guardar).toHaveBeenCalledTimes(1);
  });
});

describe('altaUsuario: cancelación y fallos', () => {
  it('si se cancela al teclear la contraseña, propaga la cancelación y no guarda', async () => {
    const montaje = montar();
    montaje.preguntarOculto.mockRejectedValueOnce(new EntradaCancelada());

    await expect(altaUsuario(montaje.deps)).rejects.toBeInstanceOf(EntradaCancelada);
    expect(montaje.guardar).not.toHaveBeenCalled();
  });

  it('si guardar falla, propaga el error de guardar (el alta no se da por buena)', async () => {
    const montaje = montar();
    montaje.guardar.mockRejectedValueOnce(new Error('sin conexion'));

    await expect(altaUsuario(montaje.deps)).rejects.toThrow('sin conexion');
    expect(montaje.salida).toEqual([]);
  });
});

describe('describirFallo: cómo termina el script', () => {
  it('una cancelación termina con 130 y dice que no se ha creado nada', () => {
    expect(describirFallo(new EntradaCancelada())).toEqual({
      mensaje: 'Cancelado: no se ha creado nada.',
      codigo: 130,
    });
  });

  it('un error de validación sale con su mensaje y el código 1', () => {
    expect(describirFallo(new ErrorAltaUsuario('Las contrasenas no coinciden.'))).toEqual({
      mensaje: 'Las contrasenas no coinciden.',
      codigo: 1,
    });
  });

  it('cualquier otro Error (la base de datos, p. ej.) sale con su mensaje y el código 1', () => {
    expect(describirFallo(new Error('connect ECONNREFUSED'))).toEqual({
      mensaje: 'connect ECONNREFUSED',
      codigo: 1,
    });
  });

  it('lo que no es un Error no se vuelca: mensaje genérico y código 1', () => {
    const valorAjeno = 'valor-sentinela-5521';

    const fallo = describirFallo({ detalle: valorAjeno });

    expect(fallo).toEqual({ mensaje: 'Error desconocido.', codigo: 1 });
    expect(JSON.stringify(fallo)).not.toContain(valorAjeno);
  });
});
