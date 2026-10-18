import { describe, expect, it } from 'vitest';
import {
  CONFIGURACION_OBJETIVOS_POR_DEFECTO,
  MAX_IMPORTE_CENTS,
  cents,
  fechaISO,
  mesCobertura,
  type MesCobertura,
  type Transaccion,
} from '@finapp/shared';
import {
  ImporteDerivadoFueraDeRango,
  calcularFotoDelMes,
  mesesPendientesDeFoto,
} from '../../src/usecases/foto-mensual-calculo';

const mes = mesCobertura;
const meses = (...valores: string[]) => valores.map(mesCobertura);

describe('mesesPendientesDeFoto', () => {
  it('sin ningún mes con datos no hay nada que fotografiar', () => {
    expect(mesesPendientesDeFoto([], new Set(), mes('2026-10'))).toEqual([]);
  });

  it('cada mes cerrado con historia detrás, desde el siguiente al primero con datos hasta el último cerrado', () => {
    expect(mesesPendientesDeFoto(['2026-06'], new Set(), mes('2026-10'))).toEqual(
      meses('2026-07', '2026-08', '2026-09'),
    );
  });

  it('el mes en curso no se fotografía, ni siquiera el último día', () => {
    // Con datos en junio, hoy en julio: junio es el primero (sin historia) y julio es el
    // mes en curso. No queda ninguno.
    expect(mesesPendientesDeFoto(['2026-06'], new Set(), mes('2026-07'))).toEqual([]);
    // Con hoy en agosto, julio ya está cerrado y tiene junio detrás.
    expect(mesesPendientesDeFoto(['2026-06'], new Set(), mes('2026-08'))).toEqual(meses('2026-07'));
  });

  it('el primer mes con datos no tiene foto: no hay con qué calcularla y un 0 sería un dato inventado', () => {
    const pendientes = mesesPendientesDeFoto(['2026-06', '2026-07'], new Set(), mes('2026-10'));

    expect(pendientes).not.toContain(mes('2026-06'));
    expect(pendientes[0]).toBe(mes('2026-07'));
  });

  it('los meses que ya tienen foto no se repiten (se respetan, no se recalculan)', () => {
    const conFoto = new Set(['2026-08']);

    expect(mesesPendientesDeFoto(['2026-06'], conFoto, mes('2026-10'))).toEqual(
      meses('2026-07', '2026-09'),
    );
  });

  it('con todas hechas no queda nada', () => {
    const conFoto = new Set(['2026-07', '2026-08', '2026-09']);

    expect(mesesPendientesDeFoto(['2026-06'], conFoto, mes('2026-10'))).toEqual([]);
  });

  it('un mes sin transacciones entre dos con datos también tiene foto: el mes siguiente la compara', () => {
    expect(mesesPendientesDeFoto(['2026-06', '2026-09'], new Set(), mes('2026-10'))).toEqual(
      meses('2026-07', '2026-08', '2026-09'),
    );
  });

  it('cruza el cambio de año', () => {
    expect(mesesPendientesDeFoto(['2026-11'], new Set(), mes('2027-02'))).toEqual(
      meses('2026-12', '2027-01'),
    );
  });

  it('no depende del orden en que lleguen los meses con datos', () => {
    expect(
      mesesPendientesDeFoto(['2026-09', '2026-06', '2026-07'], new Set(), mes('2026-10')),
    ).toEqual(meses('2026-07', '2026-08', '2026-09'));
  });

  it('una foto fuera de rango (la del mes en curso, de una versión antigua) no cambia nada', () => {
    const conFoto = new Set(['2026-10', '2026-03']);

    expect(mesesPendientesDeFoto(['2026-06'], conFoto, mes('2026-10'))).toEqual(
      meses('2026-07', '2026-08', '2026-09'),
    );
  });

  it('los datos de meses futuros no estiran el rango', () => {
    expect(mesesPendientesDeFoto(['2026-06', '2027-01'], new Set(), mes('2026-09'))).toEqual(
      meses('2026-07', '2026-08'),
    );
  });
});

describe('calcularFotoDelMes', () => {
  const VIVIENDA = 'categoria-vivienda';
  const OCIO = 'categoria-ocio';

  function gasto(
    mesDelGasto: string,
    categoriaId: string,
    importeCents: number,
    esencialRecurrente: boolean,
  ): Transaccion {
    return {
      id: `${mesDelGasto}-${categoriaId}`,
      fecha: fechaISO(`${mesDelGasto}-05`),
      mesCobertura: mes(mesDelGasto),
      tipo: 'Gasto',
      categoriaId,
      monto: cents(importeCents),
      direccion: null,
      necesidad: esencialRecurrente ? 'Esencial' : 'Prescindible',
      recurrencia: esencialRecurrente ? 'Recurrente' : 'Puntual',
      prestamoId: null,
    };
  }

  const transacciones = [
    gasto('2026-05', VIVIENDA, 60000, true),
    gasto('2026-06', VIVIENDA, 60000, true),
    gasto('2026-06', OCIO, 99999, false),
    // Los dos meses siguientes llevan un alquiler MUCHO mayor: no pueden colarse en la foto de julio.
    gasto('2026-07', VIVIENDA, 500000, true),
    gasto('2026-08', VIVIENDA, 500000, true),
  ];
  const mesesConDatos = meses('2026-05', '2026-06', '2026-07', '2026-08');
  const config = CONFIGURACION_OBJETIVOS_POR_DEFECTO;

  it('calcula con los meses con datos ANTERIORES al fotografiado, nunca con él ni con los posteriores', () => {
    const foto = calcularFotoDelMes({
      transacciones,
      categoriasDeuda: new Set(),
      mesesConDatos,
      ahorroDeclarado: cents(0),
      mes: mes('2026-07'),
      config,
    });

    // Media de mayo y junio (600,00) con el margen del 15 % = 690,00; objetivo = 6 meses.
    expect(foto).toEqual({
      mesCobertura: '2026-07',
      csm: 69000,
      objetivo: 414000,
      margenSeguridad: 0.15,
      mesesObjetivo: 6,
      desglosePorCategoria: { [VIVIENDA]: 60000 },
    });
  });

  it('el mes fotografiado entra en la foto del mes siguiente', () => {
    const foto = calcularFotoDelMes({
      transacciones,
      categoriasDeuda: new Set(),
      mesesConDatos,
      ahorroDeclarado: cents(0),
      mes: mes('2026-08'),
      config,
    });

    // Ventana de 3 meses: mayo, junio y julio -> (600 + 600 + 5000) / 3 = 2.066,67
    expect(foto.desglosePorCategoria).toEqual({ [VIVIENDA]: 206667 });
  });

  it('no depende del orden en que lleguen los meses con datos', () => {
    const pedir = (orden: MesCobertura[]) =>
      calcularFotoDelMes({
        transacciones,
        categoriasDeuda: new Set(),
        mesesConDatos: orden,
        ahorroDeclarado: cents(0),
        mes: mes('2026-09'),
        config,
      });

    // Cuatro meses previos y una ventana de tres: si no se ordenan, "los tres últimos" serían
    // otros (mayo, julio y junio, sin agosto).
    const desordenados = pedir(meses('2026-08', '2026-05', '2026-07', '2026-06'));

    // Junio, julio y agosto: (600 + 5000 + 5000) / 3 = 3.533,33
    expect(desordenados.desglosePorCategoria).toEqual({ [VIVIENDA]: 353333 });
    expect(desordenados).toEqual(pedir(mesesConDatos));
  });

  it('el objetivo no depende de lo ahorrado, solo del CSM y de los meses objetivo', () => {
    const pedir = (ahorroDeclarado: number) =>
      calcularFotoDelMes({
        transacciones,
        categoriasDeuda: new Set(),
        mesesConDatos,
        ahorroDeclarado: cents(ahorroDeclarado),
        mes: mes('2026-07'),
        config,
      });

    expect(pedir(0).objetivo).toBe(pedir(10_000_000).objetivo);
  });

  it('usa los parámetros de la configuración y los guarda en la foto', () => {
    const foto = calcularFotoDelMes({
      transacciones,
      categoriasDeuda: new Set(),
      mesesConDatos,
      ahorroDeclarado: cents(0),
      mes: mes('2026-07'),
      config: { ...config, margenSeguridad: 0.2, mesesObjetivo: 3 },
    });

    expect(foto).toMatchObject({
      csm: 72000,
      objetivo: 216000,
      margenSeguridad: 0.2,
      mesesObjetivo: 3,
    });
  });
});

describe('calcularFotoDelMes: el objetivo derivado tiene que caber en numeric(12, 2)', () => {
  const VIVIENDA = 'categoria-vivienda';
  const config = CONFIGURACION_OBJETIVOS_POR_DEFECTO;

  /** Un único gasto esencial recurrente en mayo; la foto de junio lo usa entero como base. */
  function fotoConBase(base: number, configuracion = config) {
    return calcularFotoDelMes({
      transacciones: [
        {
          id: 'x',
          fecha: fechaISO('2026-05-05'),
          mesCobertura: mes('2026-05'),
          tipo: 'Gasto',
          categoriaId: VIVIENDA,
          monto: cents(base),
          direccion: null,
          necesidad: 'Esencial',
          recurrencia: 'Recurrente',
          prestamoId: null,
        },
      ],
      categoriasDeuda: new Set(),
      mesesConDatos: meses('2026-05'),
      ahorroDeclarado: cents(0),
      mes: mes('2026-06'),
      config: configuracion,
    });
  }

  // Con el margen del 15 % y 6 meses, objetivo = base x 6,9: el mayor que cabe es 144.927.536.231.
  it('en el límite exacto la foto sale (control positivo)', () => {
    const foto = fotoConBase(144_927_536_231);

    expect(foto.csm).toBe(166_666_666_666);
    expect(foto.objetivo).toBe(999_999_999_996);
    expect(foto.objetivo).toBeLessThanOrEqual(MAX_IMPORTE_CENTS);
  });

  it('un céntimo de base más y el objetivo ya no cabe: error propio, con el mes', () => {
    let error: unknown;
    try {
      fotoConBase(144_927_536_232);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(ImporteDerivadoFueraDeRango);
    expect((error as ImporteDerivadoFueraDeRango).mes).toBe('2026-06');
  });

  it('un gasto igual al tope de entrada (legal) desborda el objetivo', () => {
    expect(() => fotoConBase(MAX_IMPORTE_CENTS)).toThrow(ImporteDerivadoFueraDeRango);
  });

  it('también se comprueba el CSM por sí solo (si el objetivo fuera menor que él)', () => {
    // 0,5 meses de objetivo no existe en la base de datos, pero esta función no lo sabe:
    // base 869.565.217.391 -> CSM 1.000.000.000.000 (no cabe); objetivo 500.000.000.000.
    const rara = { ...config, mesesObjetivo: 0.5 };

    expect(() => fotoConBase(869_565_217_389, rara)).not.toThrow();
    expect(() => fotoConBase(869_565_217_391, rara)).toThrow(ImporteDerivadoFueraDeRango);
  });

  it('el mensaje del error no lleva ningún importe', () => {
    let error: Error | undefined;
    try {
      fotoConBase(MAX_IMPORTE_CENTS);
    } catch (e) {
      error = e as Error;
    }

    expect(error).toBeDefined();
    expect(error!.message).not.toMatch(/\d{3}/);
    expect(error!.name).toBe('ImporteDerivadoFueraDeRango');
  });
});
