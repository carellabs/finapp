import { describe, expect, it } from 'vitest';
import { MAX_IMPORTE_CENTS, MOTIVO_IMPORTE_MAXIMO } from '../../src/money/limite';
import { zActualizarDeuda, zNuevaDeuda } from '../../src/schemas/deuda';
import { zNuevoObjetivo } from '../../src/schemas/objetivo';
import { zNuevoPrestamo } from '../../src/schemas/prestamo';
import { zPresupuesto } from '../../src/schemas/presupuesto';
import { zNuevoSaldoAhorro } from '../../src/schemas/saldo-ahorro';
import { zActualizarTransaccion, zNuevaTransaccion } from '../../src/schemas/transaccion';

const UUID = '11111111-1111-4111-8111-111111111111';

const TRANSACCION = {
  fecha: '2026-06-15',
  mesCobertura: '2026-06',
  categoriaId: UUID,
  metodo: 'Tarjeta',
};
const DEUDA = {
  concepto: 'Coche',
  fechaInicio: '2026-01-01',
  saldoInicialCents: 1,
  pagoMensualCents: 1,
};

interface Esquema {
  safeParse(
    dato: unknown,
  ):
    | { success: true }
    | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
}

interface Caso {
  /** `esquema` + campo, para el nombre del test y para cotejar con el código fuente. */
  nombre: string;
  esquema: Esquema;
  /** El campo de importe que se prueba. */
  campo: string;
  /** Un cuerpo válido con ese campo puesto a `valor`. */
  cuerpo: (valor: number) => Record<string, unknown>;
  admiteCero: boolean;
}

/**
 * TODOS los sitios donde un importe entra por la API. Si alguien añade un campo `…Cents`
 * a un esquema y no lo apunta aquí, el último test de este fichero lo delata.
 */
const CASOS: Caso[] = [
  ...(['Ingreso', 'Gasto', 'Transferencia'] as const).flatMap((tipo) => {
    const extra: Record<string, unknown> =
      tipo === 'Ingreso'
        ? { recurrencia: 'Recurrente' }
        : tipo === 'Gasto'
          ? { necesidad: 'Esencial', recurrencia: 'Recurrente' }
          : { direccion: 'entrada', subtipo: 'pass_through' };
    return [
      {
        nombre: `zNuevaTransaccion (${tipo}).montoCents`,
        esquema: zNuevaTransaccion,
        campo: 'montoCents',
        cuerpo: (valor: number) => ({ ...TRANSACCION, ...extra, tipo, montoCents: valor }),
        admiteCero: false,
      },
      {
        nombre: `zActualizarTransaccion (${tipo}).montoCents`,
        esquema: zActualizarTransaccion,
        campo: 'montoCents',
        cuerpo: (valor: number) => ({ ...TRANSACCION, ...extra, tipo, montoCents: valor }),
        admiteCero: false,
      },
    ];
  }),
  {
    nombre: 'zPresupuesto.montoCents',
    esquema: zPresupuesto,
    campo: 'montoCents',
    cuerpo: (valor) => ({ categoriaId: UUID, mesCobertura: '2026-06', montoCents: valor }),
    admiteCero: false,
  },
  {
    nombre: 'zNuevoPrestamo.adeudadoCents',
    esquema: zNuevoPrestamo,
    campo: 'adeudadoCents',
    cuerpo: (valor) => ({ persona: 'Ana', adeudadoCents: valor }),
    admiteCero: false,
  },
  ...([zNuevaDeuda, zActualizarDeuda] as const).flatMap((esquema, i) => {
    const nombre = i === 0 ? 'zNuevaDeuda' : 'zActualizarDeuda';
    const base = i === 0 ? DEUDA : { ...DEUDA, activa: true };
    return [
      {
        nombre: `${nombre}.saldoInicialCents`,
        esquema,
        campo: 'saldoInicialCents',
        cuerpo: (valor: number) => ({ ...base, saldoInicialCents: valor }),
        admiteCero: true,
      },
      {
        nombre: `${nombre}.pagoMensualCents`,
        esquema,
        campo: 'pagoMensualCents',
        cuerpo: (valor: number) => ({ ...base, pagoMensualCents: valor }),
        admiteCero: false,
      },
    ];
  }),
  {
    nombre: 'zNuevoObjetivo (secundario).importeObjetivoCents',
    esquema: zNuevoObjetivo,
    campo: 'importeObjetivoCents',
    cuerpo: (valor) => ({ tipo: 'secundario', nombre: 'Viaje', importeObjetivoCents: valor }),
    admiteCero: false,
  },
  {
    nombre: 'zNuevoSaldoAhorro.saldoCents',
    esquema: zNuevoSaldoAhorro,
    campo: 'saldoCents',
    cuerpo: (valor) => ({ fecha: '2026-07-01', saldoCents: valor }),
    admiteCero: true,
  },
];

describe('MAX_IMPORTE_CENTS', () => {
  it('son 12 nueves: la precisión de numeric(12, 2) (10 enteros y 2 decimales)', () => {
    expect(MAX_IMPORTE_CENTS).toBe(999_999_999_999);
    expect(String(MAX_IMPORTE_CENTS)).toBe('9'.repeat(12));
  });

  it('el motivo está en español, formatea el tope con es-ES y no lleva ningún valor recibido', () => {
    expect(MOTIVO_IMPORTE_MAXIMO).toBe('El importe no puede superar 9.999.999.999,99 €');
  });
});

describe.each(CASOS)('el tope de importe en $nombre', ({ esquema, campo, cuerpo, admiteCero }) => {
  it('acepta exactamente el tope', () => {
    expect(esquema.safeParse(cuerpo(MAX_IMPORTE_CENTS)).success).toBe(true);
  });

  it('rechaza el tope + 1 céntimo, en el campo del importe y con el motivo en español', () => {
    const resultado = esquema.safeParse(cuerpo(MAX_IMPORTE_CENTS + 1));

    expect(resultado.success).toBe(false);
    if (resultado.success) return;
    expect(resultado.error.issues).toHaveLength(1);
    expect(resultado.error.issues[0]!.path).toEqual([campo]);
    expect(resultado.error.issues[0]!.message).toBe(MOTIVO_IMPORTE_MAXIMO);
  });

  it('el motivo no vuelca el valor recibido', () => {
    const resultado = esquema.safeParse(cuerpo(MAX_IMPORTE_CENTS * 7));

    expect(resultado.success).toBe(false);
    if (resultado.success) return;
    expect(JSON.stringify(resultado.error.issues)).not.toContain(String(MAX_IMPORTE_CENTS * 7));
  });

  it('un número descomunal (1e21, ni siquiera entero seguro) da UN solo error, el del tope, en español', () => {
    const resultado = esquema.safeParse(cuerpo(1e21));

    expect(resultado.success).toBe(false);
    if (resultado.success) return;
    expect(resultado.error.issues.map((i) => ({ path: i.path, message: i.message }))).toEqual([
      { path: [campo], message: MOTIVO_IMPORTE_MAXIMO },
    ]);
  });

  it('un importe pequeño sigue pasando y los límites de signo no cambian', () => {
    expect(esquema.safeParse(cuerpo(1)).success).toBe(true);
    expect(esquema.safeParse(cuerpo(0)).success).toBe(admiteCero);
    expect(esquema.safeParse(cuerpo(-1)).success).toBe(false);
  });
});

describe('ningún campo de importe se salta los validadores compartidos', () => {
  // `shared` es dominio puro (sin módulos de Node, ni en los tests): el código fuente de los esquemas se
  // lee con la importación de texto de Vite, no con `fs`.
  const fuentes = (
    import.meta as unknown as {
      glob(
        patron: string,
        opciones: { query: string; import: string; eager: true },
      ): Record<string, string>;
    }
  ).glob('../../src/schemas/*.ts', { query: '?raw', import: 'default', eager: true });
  const campos = Object.entries(fuentes).flatMap(([ruta, codigo]) =>
    [...codigo.matchAll(/\b(\w*(?:Cents|Euros))\s*:\s*([\w.()]+)/g)].map((m) => ({
      fichero: ruta.slice(ruta.lastIndexOf('/') + 1),
      campo: m[1]!,
      validador: m[2]!,
    })),
  );

  it('el escaneo del código fuente encuentra los campos (control positivo)', () => {
    // 7 declaraciones: montoCents (transacción y presupuesto), adeudadoCents, saldoInicialCents,
    // pagoMensualCents, importeObjetivoCents y saldoCents. Los esquemas de actualización las heredan.
    expect(campos.map((c) => `${c.fichero}:${c.campo}`).sort()).toEqual([
      'deuda.ts:pagoMensualCents',
      'deuda.ts:saldoInicialCents',
      'objetivo.ts:importeObjetivoCents',
      'prestamo.ts:adeudadoCents',
      'presupuesto.ts:montoCents',
      'saldo-ahorro.ts:saldoCents',
      'transaccion.ts:montoCents',
    ]);
  });

  it('todo campo …Cents de un esquema usa zMontoCents o zMontoCentsNoNegativo', () => {
    const intrusos = campos.filter(
      (c) => c.validador !== 'zMontoCents' && c.validador !== 'zMontoCentsNoNegativo',
    );
    expect(intrusos).toEqual([]);
  });

  it('todo campo …Cents de un esquema está en la tabla de casos de este test', () => {
    const enCodigo = new Set(campos.map((c) => c.campo));
    const probados = new Set(CASOS.map((c) => c.campo));
    expect(enCodigo).toEqual(probados);
  });
});
