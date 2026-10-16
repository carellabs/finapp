import { describe, expect, it } from 'vitest';
import { cargarEnv } from '../../src/config/env';
import { cargarEnvScripts } from '../../src/config/env-scripts';

/**
 * Entorno de los scripts de operación (`crear-usuario`): solo la base de datos. No pueden
 * heredar las reglas de arranque de la API (TRUST_PROXY, ORIGEN_FRONTEND...): con
 * NODE_ENV=production, esas exigencias impedían dar de alta el usuario en el servidor sin
 * inventarse variables que el script no usa.
 */
const URL_BD = 'postgresql://usuario:clave@db:5432/finapp';

describe('cargarEnvScripts', () => {
  it('con solo DATABASE_URL carga, incluso con NODE_ENV=production', () => {
    const env = cargarEnvScripts({ NODE_ENV: 'production', DATABASE_URL: URL_BD });

    expect(env.DATABASE_URL).toBe(URL_BD);
  });

  it('control positivo: el mismo entorno SÍ impide arrancar la API (cargarEnv exige el resto)', () => {
    // Sin esto, el test anterior podría pasar aunque cargarEnvScripts no tuviera nada que ver.
    const entorno = { NODE_ENV: 'production', DATABASE_URL: URL_BD } satisfies NodeJS.ProcessEnv;

    expect(() => cargarEnv(entorno)).toThrow(/ORIGEN_FRONTEND/);
    // Con el origen ya puesto, es TRUST_PROXY lo que falta en producción.
    expect(() =>
      cargarEnv({ ...entorno, ORIGEN_FRONTEND: 'https://finanzas.example.com' }),
    ).toThrow(/TRUST_PROXY/);
  });

  it('devuelve únicamente DATABASE_URL: nada de la configuración de la API se cuela', () => {
    const env = cargarEnvScripts({
      NODE_ENV: 'production',
      PORT: '4000',
      DATABASE_URL: URL_BD,
      ORIGEN_FRONTEND: 'https://finanzas.example.com',
      MAX_SESIONES_POR_USUARIO: '9',
    });

    expect(Object.keys(env)).toEqual(['DATABASE_URL']);
  });

  it.each([
    ['sin definir', {}],
    ['vacía', { DATABASE_URL: '' }],
  ])('DATABASE_URL %s: falla y nombra la variable', (_caso, fuente) => {
    expect(() => cargarEnvScripts(fuente)).toThrow(/DATABASE_URL/);
  });

  it('el error de entorno no vuelca valores de otras variables', () => {
    const valorAjeno = 'valor-sentinela-4417';

    expect(() => cargarEnvScripts({ OTRA: valorAjeno })).toThrow(/DATABASE_URL/);
    try {
      cargarEnvScripts({ OTRA: valorAjeno });
    } catch (error) {
      expect((error as Error).message).not.toContain(valorAjeno);
    }
  });

  it('acepta y rechaza DATABASE_URL igual que la API (una sola regla, dos cargadores)', () => {
    const base = { ORIGEN_FRONTEND: 'http://localhost:5173' };
    for (const valor of [undefined, '', URL_BD]) {
      const fuente = valor === undefined ? { ...base } : { ...base, DATABASE_URL: valor };
      const aceptaApi = (() => {
        try {
          cargarEnv(fuente);
          return true;
        } catch {
          return false;
        }
      })();
      const aceptaScripts = (() => {
        try {
          cargarEnvScripts(fuente);
          return true;
        } catch {
          return false;
        }
      })();
      expect(aceptaScripts, `DATABASE_URL=${String(valor)}`).toBe(aceptaApi);
    }
  });
});
