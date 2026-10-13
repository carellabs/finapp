import { describe, expect, it } from 'vitest';
import { cents } from '../../src/money/cents';
import { fechaISO } from '../../src/time/fecha';
import { mesCobertura } from '../../src/time/mes-cobertura';
import type { Transaccion } from '../../src/domain/tipos';
import { insightVelocidadGasto } from '../../src/insights/velocidad-gasto';

const MES = mesCobertura('2026-07');

let contador = 0;
function transaccion(monto: number): Transaccion {
  contador += 1;
  return {
    id: `t${contador}`,
    fecha: fechaISO('2026-07-10'),
    mesCobertura: MES,
    tipo: 'Gasto',
    categoriaId: 'otros',
    monto: cents(monto * 100),
    direccion: null,
    necesidad: 'Flexible',
    recurrencia: 'Puntual',
    prestamoId: null,
  };
}

describe('insightVelocidadGasto (§4.3.9)', () => {
  it('proyecta el cierre del mes a partir del gasto acumulado y el día transcurrido', () => {
    // Julio tiene 31 días. Día 15,5 -> fraccion aprox 0,5. Gasto 500 -> proyección ~1000.
    const insights = insightVelocidadGasto([transaccion(500)], MES, fechaISO('2026-07-16'));

    expect(insights).toHaveLength(1);
    const proyeccion = insights[0]?.evidencia.find((e) => e.etiqueta.includes('Proyección'));
    expect(proyeccion?.cents).toBeGreaterThan(950_00);
    expect(proyeccion?.cents).toBeLessThan(1050_00);
  });

  it('antes del día 5, no se emite (un gasto grande temprano no debe disparar la proyección)', () => {
    expect(insightVelocidadGasto([transaccion(500)], MES, fechaISO('2026-07-03'))).toEqual([]);
  });

  it('si "hoy" no cae dentro del mes evaluado, no se emite', () => {
    expect(insightVelocidadGasto([transaccion(500)], MES, fechaISO('2026-08-16'))).toEqual([]);
  });
});
