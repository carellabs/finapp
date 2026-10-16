import { afterEach, describe, expect, it, vi } from 'vitest';
import { observarCambiosDeTema } from '../../src/lib/tema';

/**
 * `public/tema-previo.js` fija `data-tema` antes del primer pintado, pero es un fichero aparte:
 * si no carga (red, caché rota, un bloqueador), la app no puede quedarse sin tema. Por eso
 * `observarCambiosDeTema` aplica también el valor INICIAL, no solo los cambios.
 */
type Manejador = (evento: MediaQueryListEvent) => void;

function simularEsquemaDelSistema(oscuroAlInicio: boolean) {
  const manejadores = new Set<Manejador>();
  const consultas: string[] = [];
  vi.stubGlobal('matchMedia', (consulta: string) => {
    consultas.push(consulta);
    return {
      matches: oscuroAlInicio,
      addEventListener: (_tipo: string, manejador: Manejador) => manejadores.add(manejador),
      removeEventListener: (_tipo: string, manejador: Manejador) => manejadores.delete(manejador),
    };
  });
  return {
    manejadores,
    consultas,
    cambiarA: (oscuro: boolean) => {
      for (const manejador of manejadores) manejador({ matches: oscuro } as MediaQueryListEvent);
    },
  };
}

describe('observarCambiosDeTema', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.tema;
  });

  it('aplica el tema inicial del sistema aunque tema-previo.js no se haya ejecutado (oscuro)', () => {
    simularEsquemaDelSistema(true);
    expect(document.documentElement.dataset.tema).toBeUndefined();

    observarCambiosDeTema();

    expect(document.documentElement.dataset.tema).toBe('oscuro');
  });

  it('aplica el tema inicial del sistema aunque tema-previo.js no se haya ejecutado (claro)', () => {
    simularEsquemaDelSistema(false);

    observarCambiosDeTema();

    expect(document.documentElement.dataset.tema).toBe('claro');
  });

  it('sigue los cambios del sistema con la app abierta, en los dos sentidos', () => {
    const sistema = simularEsquemaDelSistema(false);
    observarCambiosDeTema();

    sistema.cambiarA(true);
    expect(document.documentElement.dataset.tema).toBe('oscuro');
    sistema.cambiarA(false);
    expect(document.documentElement.dataset.tema).toBe('claro');
  });

  it('pregunta por el esquema oscuro, igual que tema-previo.js', () => {
    const sistema = simularEsquemaDelSistema(false);

    observarCambiosDeTema();

    expect(sistema.consultas).toEqual(['(prefers-color-scheme: dark)']);
  });

  it('la función que devuelve deja de observar: ya no sigue los cambios', () => {
    const sistema = simularEsquemaDelSistema(false);
    const dejarDeObservar = observarCambiosDeTema();
    expect(sistema.manejadores.size).toBe(1);

    dejarDeObservar();

    expect(sistema.manejadores.size).toBe(0);
    sistema.cambiarA(true);
    expect(document.documentElement.dataset.tema).toBe('claro');
  });
});
