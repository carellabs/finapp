import { useState } from 'react';
import { cents, fechaISO, formatearEuros, formatearFecha, type FechaISO } from '@finapp/shared';
import { Boton } from '../../atoms/Boton';
import { ChipSeleccion } from '../../atoms/ChipSeleccion';
import { EstadoError } from '../../atoms/EstadoError';
import { EntradaImporte } from '../../molecules/EntradaImporte';
import { FlujoPorPasos } from '../../organisms/FlujoPorPasos';
import { importeParcialACents } from '../../lib/importe-parcial';
import { ultimosDias } from '../../lib/fechas-recientes';
import { useDeclararSaldo } from './usar-objetivos';

type PasoConciliacion = 'importe' | 'fecha' | 'resumen';
const PASOS: readonly PasoConciliacion[] = ['importe', 'fecha', 'resumen'];

interface PropiedadesTarjetaConciliacion {
  declaradoCents: number;
  calculadoCents: number;
  divergenciaCents: number;
  divergenciaSignificativa: boolean;
  ultimaFechaDeclarada: string | null;
  hoy: FechaISO;
}

/**
 * Ahorro DECLARADO por el usuario vs. CALCULADO como suma de ahorros netos
 * (objetivos-ahorro §3.6): nunca se sobrescribe una cifra con la otra, solo
 * se señala si divergen más de lo esperable.
 */
export function TarjetaConciliacion({
  declaradoCents,
  calculadoCents,
  divergenciaCents,
  divergenciaSignificativa,
  ultimaFechaDeclarada,
  hoy,
}: PropiedadesTarjetaConciliacion) {
  const [abierto, setAbierto] = useState(false);
  const [i, setI] = useState(0);
  const [importeTexto, setImporteTexto] = useState('');
  const [fecha, setFecha] = useState<FechaISO>(hoy);
  const declarar = useDeclararSaldo();

  function abrir(): void {
    setI(0);
    setImporteTexto('');
    setFecha(hoy);
    setAbierto(true);
  }

  function guardar(): void {
    declarar.mutate(
      { fecha, saldoCents: importeParcialACents(importeTexto) },
      { onSuccess: () => setAbierto(false) },
    );
  }

  const paso = PASOS[i] ?? 'resumen';
  const pregunta =
    paso === 'importe'
      ? '¿Cuál es tu saldo actual?'
      : paso === 'fecha'
        ? '¿A qué fecha corresponde?'
        : 'Repasa y guarda';

  const pasosRespondidos =
    paso === 'resumen' && importeParcialACents(importeTexto) > 0
      ? [
          {
            clave: 'importe',
            etiqueta: 'Saldo',
            valor: formatearEuros(cents(importeParcialACents(importeTexto))),
            onIr: () => setI(0),
          },
        ]
      : [];

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-borde bg-superficie p-4">
      <h3 className="text-sm font-medium text-tinta">Ahorro declarado vs. calculado</h3>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-tenue">Declarado</span>
          <p className="font-serif text-[19px] leading-[1.2] font-medium text-tinta">
            {formatearEuros(cents(declaradoCents))}
          </p>
          {ultimaFechaDeclarada !== null && (
            <p className="text-xs text-tenue">
              actualizado el {formatearFecha(fechaISO(ultimaFechaDeclarada))}
            </p>
          )}
        </div>
        <div>
          <span className="text-tenue">Calculado</span>
          <p className="font-serif text-[19px] leading-[1.2] font-medium text-tinta">
            {formatearEuros(cents(calculadoCents))}
          </p>
          <p className="text-xs text-tenue">según meses cerrados</p>
        </div>
      </div>

      {divergenciaSignificativa && (
        <p className="rounded-xl border border-oro p-2 text-sm text-oro">
          Divergencia de {formatearEuros(cents(divergenciaCents))}: puede haber gasto sin registrar.
        </p>
      )}

      <Boton variante="secundario" onClick={abrir}>
        Declarar saldo actual
      </Boton>

      {abierto && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-tinta/45">
          <button
            type="button"
            aria-label="Cerrar"
            className="absolute inset-0"
            onClick={() => setAbierto(false)}
          />
          <div className="relative flex max-h-[85vh] w-full max-w-md flex-col rounded-t-[20px] bg-papel [animation:sube-hoja_.22s_cubic-bezier(.2,.8,.2,1)]">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (paso === 'resumen') guardar();
              }}
              className="flex flex-1 flex-col"
            >
              <FlujoPorPasos
                onAtras={() => (i === 0 ? setAbierto(false) : setI((p) => Math.max(0, p - 1)))}
                etiquetaContexto="Se apila lo respondido"
                pasosRespondidos={pasosRespondidos}
                claveAnimacion={`${paso}:${i}`}
                pregunta={pregunta}
              >
                {paso === 'importe' && (
                  <EntradaImporte
                    valor={importeTexto}
                    onCambiar={setImporteTexto}
                    onContinuar={() => setI(1)}
                  />
                )}

                {paso === 'fecha' && (
                  <div className="flex flex-wrap gap-1.5">
                    {ultimosDias(hoy, 4).map((f, idx) => (
                      <ChipSeleccion
                        key={f}
                        etiqueta={idx === 0 ? 'Hoy' : idx === 1 ? 'Ayer' : formatearFecha(f)}
                        seleccionado={fecha === f}
                        onSeleccionar={() => {
                          setFecha(f);
                          setI(2);
                        }}
                      />
                    ))}
                  </div>
                )}

                {paso === 'resumen' && (
                  <div className="flex flex-1 flex-col gap-3.5">
                    <div className="flex flex-col gap-2 rounded-xl border border-borde bg-superficie p-4">
                      <div className="flex items-baseline justify-between gap-2.5">
                        <span className="text-[10px] tracking-[.16em] text-tenue uppercase">
                          Saldo
                        </span>
                        <button
                          type="button"
                          onClick={() => setI(0)}
                          className="bg-transparent p-0 text-[11px] text-tenue underline underline-offset-[3px]"
                        >
                          cambiar
                        </button>
                      </div>
                      <span className="font-serif text-[34px] leading-none text-tinta">
                        {formatearEuros(cents(importeParcialACents(importeTexto)))}
                      </span>
                      <button
                        type="button"
                        onClick={() => setI(1)}
                        className="self-start border-b border-borde-fuerte bg-transparent p-0 font-serif text-[15px] text-tinta"
                      >
                        {formatearFecha(fecha)}
                      </button>
                    </div>
                    {declarar.isError && <EstadoError mensaje="No se pudo guardar el saldo." />}
                    <Boton type="submit" disabled={declarar.isPending} className="mt-auto">
                      Guardar
                    </Boton>
                  </div>
                )}
              </FlujoPorPasos>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
