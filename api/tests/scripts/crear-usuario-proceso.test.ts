import { describe, expect, it } from 'vitest';
import { ejecutarScript, TIMEOUT_TEST_PROCESO_MS } from '../soporte/ejecutar-script';

/**
 * `crear-usuario` como proceso real (con `tsx`, como `npm run crear-usuario`). Aquí no hay
 * base de datos: la URL apunta a un puerto cerrado, y que el script falle ANTES de intentar
 * conectar es justo lo que se comprueba. El efecto sobre una base de datos real (que no se
 * crea nada) lo vigila `tests/integration/crear-usuario.test.ts`.
 */
const CONTRASENA = 'Sentinela-Por-Tuberia-2207';
// Puerto 1: nada escucha. Si el script intentara conectar, fallaría con ECONNREFUSED.
const URL_BD_CERRADA = 'postgresql://usuario:clave@127.0.0.1:1/finapp';
// Un entorno de la API completo: con el entorno ya válido, lo único que puede frenar el alta es
// el control de terminal.
const ENTORNO_COMPLETO = {
  DATABASE_URL: URL_BD_CERRADA,
  ORIGEN_FRONTEND: 'http://localhost:5173',
};
// Lo que escribiría una persona: usuario, contraseña y su repetición.
const TECLEADO = `ana\n${CONTRASENA}\n${CONTRASENA}\n`;

describe('crear-usuario: entorno', { timeout: TIMEOUT_TEST_PROCESO_MS }, () => {
  it('en producción solo necesita DATABASE_URL: no exige TRUST_PROXY ni ORIGEN_FRONTEND', () => {
    const r = ejecutarScript(
      'crear-usuario.ts',
      { NODE_ENV: 'production', DATABASE_URL: URL_BD_CERRADA },
      TECLEADO,
    );

    // Llega al control de terminal (que es lo siguiente a cargar el entorno)...
    expect(r.errores).toMatch(/terminal interactiva/i);
    // ...y no se queja de variables de la API que el script no usa.
    expect(r.errores).not.toMatch(/ORIGEN_FRONTEND|TRUST_PROXY|Configuracion de entorno/);
  });

  it('sin DATABASE_URL falla y nombra la variable', () => {
    const r = ejecutarScript('crear-usuario.ts', { NODE_ENV: 'production' }, TECLEADO);

    expect(r.estado).toBe(1);
    expect(r.errores).toMatch(/DATABASE_URL/);
    expect(r.errores).not.toContain(CONTRASENA);
  });
});

describe(
  'crear-usuario: la contraseña solo se acepta en un terminal',
  { timeout: TIMEOUT_TEST_PROCESO_MS },
  () => {
    it('con la entrada por tubería (no es un terminal) falla con un mensaje claro y sin tocar la base de datos', () => {
      const r = ejecutarScript('crear-usuario.ts', ENTORNO_COMPLETO, TECLEADO);

      expect(r.estado).toBe(1);
      expect(r.errores).toMatch(/terminal interactiva/i);
      // No llegó a conectar: de haberlo intentado, el error sería de conexión.
      expect(r.errores).not.toMatch(/ECONNREFUSED|connect/i);
      // No llegó a preguntar nada.
      expect(r.salida).not.toMatch(/Nombre de usuario|Contrasena/i);
      expect(r.salida).not.toMatch(/creado/i);
    });

    it('la contraseña recibida por la tubería no aparece ni en la salida ni en los errores', () => {
      const r = ejecutarScript('crear-usuario.ts', ENTORNO_COMPLETO, TECLEADO);

      // Control positivo: el script sí ha escrito algo (el motivo del rechazo); si no, la
      // ausencia de la contraseña no probaría nada.
      expect(r.errores.length).toBeGreaterThan(0);
      expect(r.salida + r.errores).not.toContain(CONTRASENA);
    });
  },
);
