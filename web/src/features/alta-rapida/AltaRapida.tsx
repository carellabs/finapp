import { useRef, useState } from 'react';
import { SystemClock, mesDeFecha, type Clock } from '@finapp/shared';
import { EstadoCarga } from '../../atoms/EstadoCarga';
import { EstadoError } from '../../atoms/EstadoError';
import { EstadoVacio } from '../../atoms/EstadoVacio';
import { useCategorias } from '../categorias/usar-categorias';
import { useCrearTransaccion } from '../transacciones/usar-transacciones';
import { useSesion } from '../auth/usar-auth';
import { recordarPreferenciasDeCategoria } from '../../lib/preferencias-categoria';
import { aEntradaApi, type FormularioTransaccion } from './esquema-formulario';
import { FormularioAltaRapida, type ManejadorFormularioAltaRapida } from './FormularioAltaRapida';

function valoresPorDefecto(clock: Clock): FormularioTransaccion {
  const hoy = clock.hoy();
  return {
    tipo: 'Gasto',
    fecha: hoy,
    mesCobertura: mesDeFecha(hoy),
    categoriaId: '',
    montoEuros: 0,
    metodo: 'Tarjeta',
    necesidad: 'Flexible',
    recurrencia: 'Puntual',
  };
}

interface PropiedadesAltaRapida {
  reloj?: Clock;
}

type Resultado = { tipo: 'exito' } | { tipo: 'error' };

/** Container: resuelve categorías + la mutación de alta, con feedback optimista y reversión. */
export function AltaRapida({ reloj = new SystemClock() }: PropiedadesAltaRapida) {
  const sesion = useSesion();
  const categorias = useCategorias();
  const crear = useCrearTransaccion();
  const formularioRef = useRef<ManejadorFormularioAltaRapida>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  // `RutaProtegida` ya garantiza sesión válida antes de montar esta vista,
  // así que `sesion.data` está disponible salvo el instante de re-fetch.
  const usuarioId = sesion.data?.usuarioId;

  function manejarEnvio(datos: FormularioTransaccion): void {
    setResultado(null);
    if (datos.tipo === 'Gasto' && usuarioId !== undefined) {
      recordarPreferenciasDeCategoria(usuarioId, datos.categoriaId, {
        necesidad: datos.necesidad,
        recurrencia: datos.recurrencia,
        metodo: datos.metodo,
      });
    }
    // Optimista: el formulario se limpia YA, listo para la siguiente alta.
    // Nunca un spinner bloqueante (frontend-patterns, vista "Alta rápida").
    formularioRef.current?.restablecer(valoresPorDefecto(reloj));

    crear.mutate(aEntradaApi(datos), {
      onSuccess: () => {
        setResultado({ tipo: 'exito' });
      },
      onError: () => {
        // Reversión: se restauran los datos y se vuelve al resumen para no
        // obligar a repetir el flujo entero (handoff §2.6).
        formularioRef.current?.restablecer(datos, { volverAResumen: true });
        setResultado({ tipo: 'error' });
      },
    });
  }

  if (categorias.isError) {
    return <EstadoError mensaje="No se pudieron cargar las categorías." />;
  }

  if (categorias.data === undefined) {
    return <EstadoCarga etiqueta="Cargando categorías…" />;
  }

  if (categorias.data.length === 0) {
    return <EstadoVacio mensaje="No hay categorías activas todavía." />;
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      {resultado?.tipo === 'exito' && (
        <p
          role="status"
          className="rounded-xl border border-verde bg-superficie p-3 text-sm text-verde"
        >
          Guardado.
        </p>
      )}
      <FormularioAltaRapida
        ref={formularioRef}
        categorias={categorias.data}
        valoresIniciales={valoresPorDefecto(reloj)}
        enviando={crear.isPending}
        hayError={resultado?.tipo === 'error'}
        hoy={reloj.hoy()}
        usuarioId={usuarioId}
        onEnviar={manejarEnvio}
        onDescartarError={() => setResultado(null)}
      />
    </div>
  );
}
