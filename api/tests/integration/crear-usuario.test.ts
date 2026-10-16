import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearPool, type Pool } from '../../src/db/cliente';
import { altaUsuario, type DependenciasAlta } from '../../src/auth/alta-usuario';
import { guardarUsuario } from '../../src/auth/usuarios';
import { hashearContrasena, verificarContrasena } from '../../src/auth/contrasena';
import { ejecutarScript } from '../soporte/ejecutar-script';
import { huellaDeLaBd } from '../soporte/huella-bd';

/**
 * El alta de usuario contra un Postgres real: lo que llega a la base de datos (un hash, nunca
 * la contraseña) y lo que NO llega cuando el script se ejecuta sin terminal.
 */
const urlBd = process.env.DATABASE_URL;
if (urlBd === undefined || urlBd === '') {
  throw new Error('Falta DATABASE_URL. Lanza estos tests con `npm run test:integration`.');
}

const CONTRASENA = 'Sentinela-Integracion-6093';

let pool: Pool;

beforeAll(() => {
  pool = crearPool(urlBd);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE sesiones, usuarios RESTART IDENTITY CASCADE');
});

interface FilaUsuario {
  nombre_usuario: string;
  password_hash: string;
  intentos_fallidos: number;
  bloqueado_hasta: Date | null;
}

async function usuarios(): Promise<FilaUsuario[]> {
  const { rows } = await pool.query<FilaUsuario>(
    'SELECT nombre_usuario, password_hash, intentos_fallidos, bloqueado_hasta FROM usuarios ORDER BY nombre_usuario',
  );
  return rows;
}

/** Un alta de verdad (hash Argon2id y escritura en la BD), con las preguntas tecleadas. */
function altaReal(usuario: string, contrasena: string, salida: string[]): DependenciasAlta {
  const respuestas = [contrasena, contrasena];
  return {
    esInteractivo: true,
    preguntar: () => Promise.resolve(usuario),
    preguntarOculto: () => Promise.resolve(respuestas.shift() ?? ''),
    hashear: hashearContrasena,
    guardar: (nombre, hash) => guardarUsuario(pool, nombre, hash),
    escribir: (linea) => salida.push(linea),
  };
}

describe('guardarUsuario', () => {
  it('crea el usuario con el hash que se le da', async () => {
    await guardarUsuario(pool, 'ana', 'hash-1');

    const filas = await usuarios();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ nombre_usuario: 'ana', password_hash: 'hash-1' });
  });

  it('si el usuario ya existe, cambia su hash y le quita el bloqueo y los intentos fallidos', async () => {
    await pool.query(
      `INSERT INTO usuarios (nombre_usuario, password_hash, intentos_fallidos, bloqueado_hasta)
       VALUES ('ana', 'hash-viejo', 5, now() + interval '15 minutes')`,
    );

    await guardarUsuario(pool, 'ana', 'hash-nuevo');

    const filas = await usuarios();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      password_hash: 'hash-nuevo',
      intentos_fallidos: 0,
      bloqueado_hasta: null,
    });
  });
});

describe('altaUsuario contra la base de datos', () => {
  it('guarda un hash Argon2id verificable y NUNCA la contraseña en claro', async () => {
    const salida: string[] = [];

    await altaUsuario(altaReal('ana', CONTRASENA, salida));

    const [fila] = await usuarios();
    expect(fila?.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(fila?.password_hash).not.toContain(CONTRASENA);
    expect(await verificarContrasena(fila?.password_hash ?? '', CONTRASENA)).toBe(true);
    // Y la contraseña no aparece en nada de lo que el alta escribe.
    expect(salida.join('\n')).not.toContain(CONTRASENA);
  });

  it('la contraseña no queda en ninguna columna de la base de datos', async () => {
    await altaUsuario(altaReal('ana', CONTRASENA, []));

    const { rows } = await pool.query<{ fila: string }>('SELECT u::text AS fila FROM usuarios u');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fila).not.toContain(CONTRASENA);
  });
});

describe('crear-usuario sin terminal (proceso real) no escribe en la base de datos', () => {
  const entorno = { DATABASE_URL: urlBd };
  const tecleado = `ana\n${CONTRASENA}\n${CONTRASENA}\n`;

  it('con la contraseña por tubería falla y deja la base de datos exactamente como estaba', async () => {
    // Un usuario que existe: si el script llegara a "actualizarlo", cambiaría su hash.
    await guardarUsuario(pool, 'ana', 'hash-existente');
    const antes = await huellaDeLaBd(pool);

    const r = ejecutarScript('crear-usuario.ts', entorno, tecleado);

    expect(r.estado).toBe(1);
    expect(r.errores).toMatch(/terminal interactiva/i);
    expect(await huellaDeLaBd(pool)).toEqual(antes);
    expect((await usuarios()).map((u) => u.password_hash)).toEqual(['hash-existente']);
    // La contraseña tecleada no está en nada de lo que el proceso escribió.
    expect(r.salida + r.errores).not.toContain(CONTRASENA);
  });

  it('control positivo: la misma base de datos SÍ se escribe cuando el alta se hace con terminal', async () => {
    // Sin esto, "no ha escrito nada" podría ser una base de datos que no acepta escrituras.
    const antes = await huellaDeLaBd(pool);

    await altaUsuario(altaReal('ana', CONTRASENA, []));

    expect(await huellaDeLaBd(pool)).not.toEqual(antes);
    expect(await usuarios()).toHaveLength(1);
  });
});
