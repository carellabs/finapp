import { useState } from 'react';
import { X } from 'lucide-react';
import {
  cents,
  fechaISO,
  formatearEuros,
  formatearFecha,
  zNuevoObjetivo,
  type FechaISO,
  type NuevoObjetivoEntrada,
} from '@finapp/shared';
import { Boton } from '../../atoms/Boton';
import { CampoTexto } from '../../atoms/CampoTexto';
import { ChipSeleccion } from '../../atoms/ChipSeleccion';
import { EstadoError } from '../../atoms/EstadoError';
import { EstadoVacio } from '../../atoms/EstadoVacio';
import { EntradaImporte } from '../../molecules/EntradaImporte';
import { FlujoPorPasos } from '../../organisms/FlujoPorPasos';
import { importeParcialACents } from '../../lib/importe-parcial';
import { sumarMeses } from '../../lib/fechas-recientes';
import type { ObjetivoSecundarioApi } from './usar-objetivos';
import { useCrearObjetivo, useEliminarObjetivo } from './usar-objetivos';

type PasoObjetivo = 'nombre' | 'importe' | 'fechaLimite' | 'resumen';
const PASOS: readonly PasoObjetivo[] = ['nombre', 'importe', 'fechaLimite', 'resumen'];

interface PropiedadesListaObjetivosSecundarios {
  objetivos: readonly ObjetivoSecundarioApi[];
  hoy: FechaISO;
}

export function ListaObjetivosSecundarios({
  objetivos,
  hoy,
}: PropiedadesListaObjetivosSecundarios) {
  const [abierto, setAbierto] = useState(false);
  const [i, setI] = useState(0);
  const [nombre, setNombre] = useState('');
  const [importeTexto, setImporteTexto] = useState('');
  const [fechaLimite, setFechaLimite] = useState<FechaISO | null>(null);
  const crear = useCrearObjetivo();
  const eliminar = useEliminarObjetivo();

  function abrir(): void {
    setI(0);
    setNombre('');
    setImporteTexto('');
    setFechaLimite(null);
    setAbierto(true);
  }

  function guardar(): void {
    // `parse` lanza (y en un manejador de React nadie lo ve) si algo no valida. Aquí no puede pasar:
    // "Continuar" no se habilita con nombre vacío (paso 1) ni con un importe 0 o por encima de
    // `MAX_IMPORTE_CENTS` (`EntradaImporte`, paso 2). Si se añade otra regla al esquema, hay que
    // darle su puerta antes de este punto o pasar a `safeParse`.
    const entrada: NuevoObjetivoEntrada = zNuevoObjetivo.parse({
      tipo: 'secundario',
      nombre,
      importeObjetivoCents: importeParcialACents(importeTexto),
      ...(fechaLimite !== null ? { fechaLimite } : {}),
    });
    crear.mutate(entrada, { onSuccess: () => setAbierto(false) });
  }

  const paso = PASOS[i] ?? 'resumen';
  const pregunta =
    paso === 'nombre'
      ? '¿Cómo se llama este objetivo?'
      : paso === 'importe'
        ? '¿Cuánto quieres ahorrar?'
        : paso === 'fechaLimite'
          ? '¿Para cuándo?'
          : 'Repasa y guarda';

  const sugerenciasFecha: { valor: FechaISO | null; etiqueta: string }[] = [
    { valor: null, etiqueta: 'Sin fecha' },
    { valor: sumarMeses(hoy, 3), etiqueta: formatearFecha(sumarMeses(hoy, 3)) },
    { valor: sumarMeses(hoy, 6), etiqueta: formatearFecha(sumarMeses(hoy, 6)) },
    { valor: sumarMeses(hoy, 12), etiqueta: formatearFecha(sumarMeses(hoy, 12)) },
  ];

  const pasosRespondidos =
    paso === 'resumen'
      ? [
          { clave: 'nombre', etiqueta: 'Nombre', valor: nombre, onIr: () => setI(0) },
          {
            clave: 'importe',
            etiqueta: 'Importe',
            valor: formatearEuros(cents(importeParcialACents(importeTexto))),
            onIr: () => setI(1),
          },
        ]
      : [];

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-borde bg-superficie p-4">
      <h3 className="text-sm font-medium text-tinta">Objetivos secundarios</h3>

      {objetivos.length === 0 ? (
        <EstadoVacio mensaje="Sin objetivos secundarios todavía." />
      ) : (
        <ul className="flex flex-col gap-2">
          {objetivos.map((o) => (
            <li
              key={o.id}
              className="flex items-center justify-between rounded-xl border border-borde p-3 text-sm"
            >
              <div>
                <p className="text-tinta">{o.nombre}</p>
                <p className="font-serif text-[15px] text-tenue">
                  {formatearEuros(cents(o.importeObjetivoCents))}
                  {o.fechaLimite !== null &&
                    ` · antes del ${formatearFecha(fechaISO(o.fechaLimite))}`}
                  {o.mensualNecesarioCents !== null &&
                    ` · ${formatearEuros(cents(o.mensualNecesarioCents))}/mes`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs ${
                    o.compatibleConRitmoActual
                      ? 'border-verde text-verde'
                      : 'border-burdeos text-burdeos'
                  }`}
                >
                  {o.compatibleConRitmoActual ? 'Compatible' : 'No compatible'}
                </span>
                <button
                  type="button"
                  aria-label={`Eliminar ${o.nombre}`}
                  onClick={() => eliminar.mutate(o.id)}
                  className="text-tenue hover:text-burdeos"
                >
                  <X aria-hidden="true" size={14} strokeWidth={1.4} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Boton variante="secundario" onClick={abrir}>
        Añadir objetivo
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
                {paso === 'nombre' && (
                  <div className="flex flex-1 flex-col gap-3">
                    <CampoTexto
                      etiqueta="Nombre"
                      type="text"
                      value={nombre}
                      onChange={(e) => setNombre(e.target.value)}
                      autoFocus
                    />
                    <Boton
                      type="button"
                      onClick={() => setI(1)}
                      disabled={nombre.trim() === ''}
                      className="mt-auto"
                    >
                      Continuar
                    </Boton>
                  </div>
                )}

                {paso === 'importe' && (
                  <EntradaImporte
                    valor={importeTexto}
                    onCambiar={setImporteTexto}
                    onContinuar={() => setI(2)}
                  />
                )}

                {paso === 'fechaLimite' && (
                  <div className="flex flex-wrap gap-1.5">
                    {sugerenciasFecha.map((s) => (
                      <ChipSeleccion
                        key={s.etiqueta}
                        etiqueta={s.etiqueta}
                        seleccionado={fechaLimite === s.valor}
                        onSeleccionar={() => {
                          setFechaLimite(s.valor);
                          setI(3);
                        }}
                      />
                    ))}
                  </div>
                )}

                {paso === 'resumen' && (
                  <div className="flex flex-1 flex-col gap-3.5">
                    <div className="flex flex-col gap-2 rounded-xl border border-borde bg-superficie p-4">
                      <span className="font-serif text-lg text-tinta">{nombre}</span>
                      <div className="flex items-baseline justify-between gap-2.5">
                        <span className="font-serif text-[34px] leading-none text-tinta">
                          {formatearEuros(cents(importeParcialACents(importeTexto)))}
                        </span>
                        <button
                          type="button"
                          onClick={() => setI(1)}
                          className="bg-transparent p-0 text-[11px] text-tenue underline underline-offset-[3px]"
                        >
                          cambiar
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setI(2)}
                        className="self-start border-b border-borde-fuerte bg-transparent p-0 text-sm text-tinta"
                      >
                        {fechaLimite === null
                          ? 'Sin fecha límite'
                          : `Antes del ${formatearFecha(fechaLimite)}`}
                      </button>
                    </div>
                    {crear.isError && <EstadoError mensaje="No se pudo crear el objetivo." />}
                    <Boton type="submit" disabled={crear.isPending} className="mt-auto">
                      Añadir
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
