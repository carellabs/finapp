import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_IMPORTE_CENTS } from '@finapp/shared';
import {
  analizarMigraciones,
  contarMencionesDeTipoNumerico,
  problemasDeColumnas,
} from './soporte/esquema-sql';

/**
 * MAX_IMPORTE_CENTS (el tope de los validadores) sale de la precisión de las columnas de
 * importe. Este test lee las migraciones (con el analizador de ./soporte/esquema-sql, que tiene sus
 * propios tests en esquema-sql.test.ts) y falla, con el nombre de la tabla y la columna, si alguna
 * tiene otra precisión, si aparece una columna money/float/entera o numeric sin precisión que nadie
 * ha clasificado, o si un tipo numérico se declara de una forma que el analizador no entiende.
 */
const MIGRACIONES = fileURLToPath(new URL('../migraciones/', import.meta.url));

function sqlDeLasMigraciones(): string[] {
  return readdirSync(MIGRACIONES)
    .filter((fichero) => fichero.endsWith('.sql'))
    .sort()
    .map((fichero) => readFileSync(`${MIGRACIONES}${fichero}`, 'utf8'));
}

/** Columnas por las que ENTRA un importe: las acota el validador compartido (zMontoCents). */
const IMPORTES_DE_ENTRADA = [
  'transacciones.monto',
  'presupuestos.monto',
  'prestamos.adeudado',
  'deudas.saldo_inicial',
  'deudas.pago_mensual',
  'objetivos.importe_objetivo',
  'saldo_ahorro_declarado.saldo',
];

/**
 * Columnas DERIVADAS: nadie las rellena desde la API; las escribe la tarea
 * foto-mensual-objetivos con csm = media mensual x (1 + margen) y objetivo = csm x
 * meses_objetivo (aprox. x6,9). Ningun validador de entrada puede acotarlas: la media es de
 * SUMAS mensuales y el numero de transacciones por mes no tiene tope. Por eso NO se
 * comparan con el tope de entrada por ser su origen: su guardian es calcularFotoDelMes
 * (ImporteDerivadoFueraDeRango: el mes se omite). Aun asi ese guardian usa MAX_IMPORTE_CENTS,
 * asi que su precision debe seguir siendo la misma; si se ensanchan, hay que actualizar
 * cabeEnColumnaDeImporte y este test a la vez.
 */
const IMPORTES_DERIVADOS = ['objetivo_historico.csm', 'objetivo_historico.objetivo'];

/** Columnas numéricas (de cualquier tipo) que NO son dinero: un porcentaje, un número de meses, un contador. */
const NUMERICAS_QUE_NO_SON_IMPORTES = [
  'objetivo_historico.margen_seguridad',
  'objetivo_historico.meses_objetivo',
  'usuarios.intentos_fallidos',
];

const CLASIFICACION = {
  entrada: IMPORTES_DE_ENTRADA,
  derivadas: IMPORTES_DERIVADOS,
  noImportes: NUMERICAS_QUE_NO_SON_IMPORTES,
};

describe('las columnas de importe y MAX_IMPORTE_CENTS', () => {
  const migraciones = sqlDeLasMigraciones();
  const esquema = analizarMigraciones(migraciones);

  it('el analizador encuentra las columnas (control: no es un test vacío)', () => {
    expect(esquema.columnas.size).toBeGreaterThanOrEqual(40);
    expect(esquema.columnas.get('transacciones.monto')).toMatchObject({
      tipo: 'numeric(12,2)',
      precision: 12,
      escala: 2,
    });
    expect(esquema.columnas.get('objetivo_historico.margen_seguridad')).toMatchObject({
      precision: 5,
      escala: 4,
    });
    expect(esquema.columnas.get('objetivo_historico.meses_objetivo')?.base).toBe('integer');
    expect(esquema.columnas.get('transacciones.descripcion')?.base).toBe('text');
  });

  it('todo tipo numérico que se menciona en las migraciones es una columna que el analizador entiende', () => {
    // Un CREATE DOMAIN, un CREATE TABLE AS o un cast dentro de un CHECK pasarían de largo.
    expect(esquema.declaracionesNumericas).toBe(contarMencionesDeTipoNumerico(migraciones));
  });

  it('toda columna numérica está bien clasificada y es coherente con MAX_IMPORTE_CENTS', () => {
    expect(problemasDeColumnas(esquema.columnas, CLASIFICACION, MAX_IMPORTE_CENTS)).toEqual([]);
  });

  it('las 7 columnas de entrada son numeric(12, 2) y MAX_IMPORTE_CENTS son sus 12 nueves', () => {
    for (const nombre of IMPORTES_DE_ENTRADA) {
      expect({ nombre, ...esquema.columnas.get(nombre) }).toMatchObject({
        nombre,
        tipo: 'numeric(12,2)',
      });
    }
    expect(10 ** 12 - 1).toBe(MAX_IMPORTE_CENTS);
  });

  it('las 2 derivadas siguen siendo numeric(12, 2): la precisión que da por supuesta su guardián', () => {
    for (const nombre of IMPORTES_DERIVADOS) {
      expect({ nombre, ...esquema.columnas.get(nombre) }).toMatchObject({
        nombre,
        tipo: 'numeric(12,2)',
      });
    }
  });
});
