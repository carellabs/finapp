import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  cents,
  esFechaISOValida,
  fechaISO,
  formatearEuros,
  formatearFecha,
  formatearMes,
  mesAnterior,
  mesCobertura,
  mesDeFecha,
  mesSiguiente,
  type DireccionTransferencia,
  type FechaISO,
  type TipoTransaccion,
} from '@finapp/shared';
import { TarjetaOpcion } from '../../atoms/TarjetaOpcion';
import { RejillaOpciones } from '../../atoms/RejillaOpciones';
import { ChipSeleccion } from '../../atoms/ChipSeleccion';
import { ChipEditable } from '../../atoms/ChipEditable';
import { Boton } from '../../atoms/Boton';
import { EntradaImporte } from '../../molecules/EntradaImporte';
import { FlujoPorPasos } from '../../organisms/FlujoPorPasos';
import { importeParcialACents } from '../../lib/importe-parcial';
import { ultimosDias } from '../../lib/fechas-recientes';
import {
  categoriasFrecuentes,
  etiquetaCortaCategoria,
  iconoDeCategoria,
} from '../../lib/iconos-categoria';
import { preferenciasDeCategoria } from '../../lib/preferencias-categoria';
import type { CategoriaApi } from '../categorias/usar-categorias';
import { zFormularioTransaccion, type FormularioTransaccion } from './esquema-formulario';

type Paso = 'tipo' | 'importe' | 'categoria' | 'direccion' | 'resumen';
type CampoEdicion =
  'necesidad' | 'recurrencia' | 'metodo' | 'fecha' | 'mesCobertura' | 'subtipo' | 'descripcion';

const METODOS = ['Tarjeta', 'Efectivo', 'Transferencia', 'Domiciliacion', 'Bizum', 'Otro'] as const;

/** Nombres de campo en un texto que se pueda leer sin conocer el esquema. */
const ETIQUETA_CAMPO: Record<string, string> = {
  categoriaId: 'Categoría',
  montoEuros: 'Importe',
  fecha: 'Fecha',
  mesCobertura: 'Mes de cobertura',
  metodo: 'Método de pago',
  necesidad: 'Necesidad',
  recurrencia: 'Recurrencia',
  direccion: 'Dirección',
  subtipo: 'Subtipo',
  descripcion: 'Concepto',
};

function etiquetaMetodo(valor: string): string {
  return valor === 'Domiciliacion' ? 'Domiciliación' : valor;
}

function pasosDe(tipo: TipoTransaccion): Paso[] {
  if (tipo === 'Transferencia') return ['tipo', 'importe', 'direccion', 'resumen'];
  return ['tipo', 'importe', 'categoria', 'resumen'];
}

function construirImporteTexto(montoEuros: number): string {
  if (montoEuros <= 0) return '';
  return montoEuros.toFixed(2).replace('.', ',');
}

export interface ManejadorFormularioAltaRapida {
  restablecer: (valores: FormularioTransaccion, opciones?: { volverAResumen?: boolean }) => void;
}

interface PropiedadesFormularioAltaRapida {
  categorias: readonly CategoriaApi[];
  valoresIniciales: FormularioTransaccion;
  enviando: boolean;
  hayError: boolean;
  hoy: FechaISO;
  /** `undefined` solo en el instante transitorio antes de que `useSesion()` resuelva; ver `AltaRapida.tsx`. */
  usuarioId: string | undefined;
  onEnviar: (datos: FormularioTransaccion) => void;
  onDescartarError: () => void;
}

/** Presentacional puro: no conoce la API ni TanStack Query, solo emite `onEnviar`. */
export const FormularioAltaRapida = forwardRef<
  ManejadorFormularioAltaRapida,
  PropiedadesFormularioAltaRapida
>(
  (
    {
      categorias,
      valoresIniciales,
      enviando,
      hayError,
      hoy,
      usuarioId,
      onEnviar,
      onDescartarError,
    },
    ref,
  ) => {
    // `shouldUnregister` NO aplica aquí: existía para el formulario anterior,
    // que ligaba cada campo a un <input>/<select> real vía `register()` y
    // necesitaba limpiar el valor al desmontar el campo condicional (p.ej.
    // `necesidad` al pasar de Gasto a Ingreso). El wizard ya no registra
    // ningún campo — todo se lee/escribe con `watch`/`setValue` — y con
    // `shouldUnregister: true`, RHF no hidrata el valor de un campo nunca
    // registrado aunque esté en `defaultValues`: `watch('fecha')` devolvía
    // `undefined` hasta el primer `setValue('fecha', ...)` manual, y
    // `fechaISO(undefined)` reventaba el render. `false` (el default de RHF)
    // sí expone `defaultValues` de entrada.
    const {
      watch,
      setValue,
      reset,
      handleSubmit,
      formState: { errors },
    } = useForm<FormularioTransaccion>({
      resolver: zodResolver(zFormularioTransaccion),
      defaultValues: valoresIniciales,
    });

    const [mesCoberturaTocado, setMesCoberturaTocado] = useState(false);
    const [i, setI] = useState(0);
    const [importeTexto, setImporteTexto] = useState('');
    const [verTodas, setVerTodas] = useState(false);
    const [editando, setEditando] = useState<CampoEdicion | null>(null);

    const tipo = watch('tipo');
    const fecha = watch('fecha');
    const mesCoberturaActual = watch('mesCobertura');
    const categoriaId = watch('categoriaId');
    const montoEuros = watch('montoEuros');
    const necesidad = watch('necesidad');
    const recurrencia = watch('recurrencia');
    const metodo = watch('metodo');
    const direccion = watch('direccion');
    const subtipo = watch('subtipo');
    const descripcion = watch('descripcion');

    // mes_cobertura se autocompleta a partir de la fecha, pero con opción
    // SIEMPRE visible de sobrescribir (frontend-patterns, vista "Alta rápida"):
    // en cuanto la persona toca el campo directamente, deja de seguir a la fecha.
    useEffect(() => {
      if (!mesCoberturaTocado && esFechaISOValida(fecha)) {
        setValue('mesCobertura', mesDeFecha(fechaISO(fecha)));
      }
    }, [fecha, mesCoberturaTocado, setValue]);

    useImperativeHandle(ref, () => ({
      restablecer: (valores, opciones) => {
        setMesCoberturaTocado(false);
        reset(valores);
        setEditando(null);
        if (opciones?.volverAResumen === true) {
          setI(pasosDe(valores.tipo).length - 1);
          setImporteTexto(construirImporteTexto(valores.montoEuros));
        } else {
          setI(0);
          setImporteTexto('');
          setVerTodas(false);
        }
      },
    }));

    const pasos = pasosDe(tipo);
    const paso: Paso = pasos[i] ?? 'resumen';
    const categoriaSeleccionada = categorias.find((c) => c.id === categoriaId);

    function irAPaso(indice: number): void {
      setEditando(null);
      setI(indice);
    }

    function atras(): void {
      setEditando(null);
      setI((previo) => Math.max(0, previo - 1));
    }

    function elegirTipo(valor: TipoTransaccion): void {
      setValue('tipo', valor);
      if (valor === 'Transferencia') {
        // Una transferencia no pregunta categoría (no la tiene como concepto),
        // pero `categoriaId` sigue siendo obligatorio en el esquema: se usa la
        // categoría marcada como pass-through. Se busca por la BANDERA, nunca
        // por el nombre — renombrarla no puede romper el alta (migración 0002).
        setValue('categoriaId', categorias.find((c) => c.esPassThrough)?.id ?? '');
        setValue('direccion', 'entrada');
        setValue('subtipo', 'pass_through');
      } else {
        setValue('categoriaId', '');
        setValue('necesidad', 'Esencial');
        setValue('recurrencia', 'Recurrente');
        setValue('metodo', valor === 'Ingreso' ? 'Transferencia' : 'Tarjeta');
      }
      setVerTodas(false);
      setI(1);
    }

    function confirmarImporte(): void {
      const importeCents = importeParcialACents(importeTexto);
      if (importeCents <= 0) return;
      setValue('montoEuros', importeCents / 100);
      setI(2);
    }

    function elegirCategoria(idCategoria: string): void {
      const categoria = categorias.find((c) => c.id === idCategoria);
      setValue('categoriaId', idCategoria);
      if (categoria !== undefined && usuarioId !== undefined) {
        const preferencias = preferenciasDeCategoria(usuarioId, categoria.id, categoria.nombre);
        if (tipo === 'Gasto') setValue('necesidad', preferencias.necesidad);
        if (tipo === 'Gasto' || tipo === 'Ingreso') {
          setValue('recurrencia', preferencias.recurrencia);
          setValue('metodo', preferencias.metodo);
        }
      }
      setVerTodas(false);
      setI(3);
    }

    function elegirDireccion(valor: DireccionTransferencia): void {
      setValue('direccion', valor);
      setI(3);
    }

    const categoriasFrecuentesLista =
      tipo === 'Gasto' || tipo === 'Ingreso' ? categoriasFrecuentes(categorias, tipo) : [];
    const categoriasVisibles =
      verTodas || categoriasFrecuentesLista.length === 0 ? categorias : categoriasFrecuentesLista;

    const pregunta = (() => {
      if (paso === 'tipo') return '¿Qué quieres registrar?';
      if (paso === 'importe') {
        return tipo === 'Gasto'
          ? '¿Cuánto gastaste?'
          : tipo === 'Ingreso'
            ? '¿Cuánto has ingresado?'
            : '¿Cuánto has movido?';
      }
      if (paso === 'categoria')
        return tipo === 'Ingreso' ? '¿De dónde viene?' : '¿En qué categoría?';
      if (paso === 'direccion') return '¿Entra o sale?';
      return 'Repasa y guarda';
    })();

    const etiquetaPorPaso: Record<Paso, string> = {
      tipo: 'Tipo',
      importe: 'Importe',
      categoria: 'Categoría',
      direccion: 'Dirección',
      resumen: 'Resumen',
    };
    const valorPorPaso: Partial<Record<Paso, string | null>> = {
      tipo,
      importe: montoEuros > 0 ? `${formatearEuros(cents(Math.round(montoEuros * 100)))}` : null,
      categoria: categoriaSeleccionada?.nombre ?? null,
      direccion: direccion === 'entrada' ? 'Entra' : direccion === 'salida' ? 'Sale' : null,
    };
    const pasosRespondidos = pasos
      .map((p, idx) => ({ p, idx }))
      .filter(({ p, idx }) => idx < i && p !== 'resumen' && (valorPorPaso[p] ?? null) !== null)
      .map(({ p, idx }) => ({
        clave: p,
        etiqueta: etiquetaPorPaso[p],
        valor: valorPorPaso[p] as string,
        onIr: () => irAPaso(idx),
      }));

    function etiquetaFecha(valor: string): string {
      const dias = ultimosDias(hoy, 2);
      if (valor === dias[0]) return 'Hoy';
      if (valor === dias[1]) return 'Ayer';
      return formatearFecha(fechaISO(valor));
    }

    const tituloEdicion: Record<CampoEdicion, string> = {
      necesidad: '¿Cuánto de obligatorio es?',
      recurrencia: '¿Se repite cada mes?',
      metodo: '¿Cómo pagaste?',
      fecha: '¿Qué día fue?',
      mesCobertura: '¿A qué mes pertenece?',
      subtipo: '¿Qué clase de movimiento es?',
      descripcion: '¿Quieres añadir un concepto?',
    };
    const notaEdicion: Record<CampoEdicion, string> = {
      necesidad: 'Se recuerda por categoría: la próxima vez ya viene marcado.',
      recurrencia: 'Se recuerda por categoría: la próxima vez ya viene marcado.',
      metodo: 'Por defecto, el último método que usaste.',
      fecha: 'Hoy viene preseleccionado; un toque para corregir.',
      mesCobertura: 'Autocalculado desde la fecha. La nómina del 30 de junio cubre julio.',
      subtipo: '',
      descripcion: 'Opcional: una nota corta para recordar de qué fue.',
    };

    function opcionesPara(
      campo: CampoEdicion,
    ): { valor: string; etiqueta: string; seleccionada: boolean; onSeleccionar: () => void }[] {
      if (campo === 'necesidad') {
        return (['Esencial', 'Flexible', 'Prescindible'] as const).map((v) => ({
          valor: v,
          etiqueta: v,
          seleccionada: necesidad === v,
          onSeleccionar: () => {
            setValue('necesidad', v);
            setEditando(null);
          },
        }));
      }
      if (campo === 'recurrencia') {
        return (['Recurrente', 'Puntual'] as const).map((v) => ({
          valor: v,
          etiqueta: v,
          seleccionada: recurrencia === v,
          onSeleccionar: () => {
            setValue('recurrencia', v);
            setEditando(null);
          },
        }));
      }
      if (campo === 'metodo') {
        return METODOS.map((v) => ({
          valor: v,
          etiqueta: etiquetaMetodo(v),
          seleccionada: metodo === v,
          onSeleccionar: () => {
            setValue('metodo', v);
            setEditando(null);
          },
        }));
      }
      if (campo === 'fecha') {
        return ultimosDias(hoy, 4).map((f, idx) => ({
          valor: f,
          etiqueta: idx === 0 ? 'Hoy' : idx === 1 ? 'Ayer' : formatearFecha(f),
          seleccionada: fecha === f,
          onSeleccionar: () => {
            setValue('fecha', f);
            setEditando(null);
          },
        }));
      }
      if (campo === 'mesCobertura') {
        const base = mesCobertura(mesCoberturaActual);
        return [mesAnterior(base), base, mesSiguiente(base)].map((m) => ({
          valor: m,
          etiqueta: formatearMes(m),
          seleccionada: mesCoberturaActual === m,
          onSeleccionar: () => {
            setValue('mesCobertura', m);
            setMesCoberturaTocado(true);
            setEditando(null);
          },
        }));
      }
      if (campo === 'descripcion') return [];
      return (
        [
          ['pass_through', 'Pass-through'],
          ['traspaso_ahorro', 'Traspaso a ahorro'],
        ] as const
      ).map(([v, e]) => ({
        valor: v,
        etiqueta: e,
        seleccionada: subtipo === v,
        onSeleccionar: () => {
          setValue('subtipo', v);
          setEditando(null);
        },
      }));
    }

    // `errors` solo se puebla tras intentar enviar (modo `onSubmit` de RHF).
    // Sin esto, un fallo de validación deja el botón "Guardar" mudo y la
    // persona no tiene forma de saber qué falta.
    const erroresVisibles = Object.entries(errors)
      .map(([campo, error]) => ({
        campo,
        mensaje: (error as { message?: string } | undefined)?.message ?? '',
      }))
      .filter((e) => e.mensaje !== '');

    interface DefinicionChip {
      campo: CampoEdicion;
      valor: string;
    }
    const mesEtiqueta = `cubre ${formatearMes(mesCobertura(mesCoberturaActual))}`;
    const descripcionEtiqueta =
      descripcion === undefined || descripcion === ''
        ? 'Añadir concepto'
        : descripcion.length > 24
          ? `${descripcion.slice(0, 24)}…`
          : descripcion;
    const chipsDef: DefinicionChip[] =
      tipo === 'Transferencia'
        ? [
            {
              campo: 'subtipo',
              valor: subtipo === 'traspaso_ahorro' ? 'Traspaso a ahorro' : 'Pass-through',
            },
            { campo: 'fecha', valor: etiquetaFecha(fecha) },
            { campo: 'mesCobertura', valor: mesEtiqueta },
            { campo: 'descripcion', valor: descripcionEtiqueta },
          ]
        : tipo === 'Ingreso'
          ? [
              { campo: 'recurrencia', valor: recurrencia ?? '' },
              { campo: 'metodo', valor: etiquetaMetodo(metodo ?? '') },
              { campo: 'fecha', valor: etiquetaFecha(fecha) },
              { campo: 'mesCobertura', valor: mesEtiqueta },
              { campo: 'descripcion', valor: descripcionEtiqueta },
            ]
          : [
              { campo: 'necesidad', valor: necesidad ?? '' },
              { campo: 'recurrencia', valor: recurrencia ?? '' },
              { campo: 'metodo', valor: etiquetaMetodo(metodo ?? '') },
              { campo: 'fecha', valor: etiquetaFecha(fecha) },
              { campo: 'mesCobertura', valor: mesEtiqueta },
              { campo: 'descripcion', valor: descripcionEtiqueta },
            ];

    // Si no hay categoría resuelta se dice, no se inventa un nombre: para una
    // Transferencia sin categoría pass-through en la BD, mentir aquí ocultaría
    // justo el motivo por el que el guardado va a fallar.
    const nombreCategoriaResumen = categoriaSeleccionada?.nombre ?? '—';
    const IconoCategoriaResumen =
      categoriaSeleccionada !== undefined
        ? iconoDeCategoria(categoriaSeleccionada.nombre)
        : ArrowLeftRight;

    const resumenLegible = `${formatearEuros(cents(Math.round(montoEuros * 100)))} en ${nombreCategoriaResumen}${
      tipo === 'Gasto' && necesidad !== undefined && recurrencia !== undefined
        ? `, ${necesidad.toLowerCase()} y ${recurrencia.toLowerCase()}`
        : ''
    }`;

    return (
      <form
        onSubmit={(e) => void handleSubmit(onEnviar)(e)}
        noValidate
        className="flex flex-1 flex-col"
      >
        <FlujoPorPasos
          onAtras={atras}
          etiquetaContexto="Se apila lo respondido"
          pasosRespondidos={pasosRespondidos}
          claveAnimacion={`${paso}:${i}`}
          pregunta={pregunta}
        >
          {paso === 'tipo' && (
            <div className="flex flex-col gap-2.5">
              <TarjetaOpcion
                icono={TrendingDown}
                titulo="Gasto"
                nota="Dinero que sale"
                onSeleccionar={() => elegirTipo('Gasto')}
              />
              <TarjetaOpcion
                icono={TrendingUp}
                titulo="Ingreso"
                nota="Dinero que entra"
                onSeleccionar={() => elegirTipo('Ingreso')}
              />
              <TarjetaOpcion
                icono={ArrowLeftRight}
                titulo="Transferencia"
                nota="Solo cambia de sitio"
                onSeleccionar={() => elegirTipo('Transferencia')}
              />
            </div>
          )}

          {paso === 'importe' && (
            <EntradaImporte
              valor={importeTexto}
              onCambiar={setImporteTexto}
              onContinuar={confirmarImporte}
            />
          )}

          {paso === 'categoria' && (
            <div className="flex flex-col gap-2.5">
              <RejillaOpciones
                opciones={categoriasVisibles.map((c) => ({
                  id: c.id,
                  icono: iconoDeCategoria(c.nombre),
                  etiqueta: etiquetaCortaCategoria(c.nombre),
                }))}
                onSeleccionar={elegirCategoria}
              />
              {categoriasFrecuentesLista.length > 0 && (
                <button
                  type="button"
                  onClick={() => setVerTodas((v) => !v)}
                  className="self-start bg-transparent p-0.5 text-[13px] text-tenue underline underline-offset-[3px]"
                >
                  {verTodas ? 'Ver solo las frecuentes' : 'Ver todas las categorías'}
                </button>
              )}
            </div>
          )}

          {paso === 'direccion' && (
            <div className="flex flex-col gap-2.5">
              <TarjetaOpcion
                icono={ArrowDownLeft}
                titulo="Entra"
                nota="Alguien me devuelve dinero"
                onSeleccionar={() => elegirDireccion('entrada')}
              />
              <TarjetaOpcion
                icono={ArrowUpRight}
                titulo="Sale"
                nota="Presto dinero o traspaso a ahorro"
                onSeleccionar={() => elegirDireccion('salida')}
              />
              <p className="mt-0.5 text-xs font-light text-tenue">
                Una transferencia nunca cuenta como gasto ni como ingreso: solo mueve dinero de
                sitio.
              </p>
            </div>
          )}

          {paso === 'resumen' && (
            <div className="flex flex-1 flex-col gap-3.5">
              <div className="flex flex-col gap-2.5 rounded-xl border border-borde bg-superficie p-4 shadow-[var(--sombra)]">
                <div className="flex items-baseline justify-between gap-2.5">
                  <span className="text-[10px] tracking-[.16em] text-tenue uppercase">{tipo}</span>
                  <button
                    type="button"
                    onClick={() => irAPaso(1)}
                    className="bg-transparent p-0 text-[11px] text-tenue underline underline-offset-[3px]"
                  >
                    cambiar
                  </button>
                </div>
                <span className="font-serif text-[34px] leading-none text-tinta">
                  {formatearEuros(cents(Math.round(montoEuros * 100)))}
                </span>
                <button
                  type="button"
                  onClick={() => irAPaso(2)}
                  className="flex items-center gap-2 self-start bg-transparent p-0"
                >
                  <IconoCategoriaResumen
                    aria-hidden="true"
                    size={16}
                    strokeWidth={1.4}
                    className="text-verde"
                  />
                  <span className="border-b border-borde-fuerte font-serif text-[15px] text-tinta">
                    {nombreCategoriaResumen}
                  </span>
                </button>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-[10px] tracking-[.14em] text-tenue uppercase">
                  Lo demás, ya rellenado
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {chipsDef.map((chip) => (
                    <ChipEditable
                      key={chip.campo}
                      valor={chip.valor}
                      abierto={editando === chip.campo}
                      onAlternar={() => setEditando(editando === chip.campo ? null : chip.campo)}
                    />
                  ))}
                </div>
                {editando !== null && (
                  <div className="flex flex-col gap-1.5 rounded-[11px] border border-borde bg-superficie p-3 [animation:entra-chip_.18s_ease]">
                    <span className="text-[10px] tracking-[.14em] text-tenue uppercase">
                      {tituloEdicion[editando]}
                    </span>
                    {editando === 'descripcion' ? (
                      <input
                        type="text"
                        maxLength={500}
                        autoFocus
                        placeholder="Cena con amigos, alquiler de agosto…"
                        defaultValue={descripcion ?? ''}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                        }}
                        onBlur={(e) => {
                          const valor = e.target.value.trim();
                          setValue('descripcion', valor === '' ? undefined : valor);
                          setEditando(null);
                        }}
                        className="w-full rounded-[10px] border border-borde bg-superficie px-3 py-[7px] text-[13px] text-tinta outline-none focus:border-verde"
                      />
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {opcionesPara(editando).map((o) => (
                          <ChipSeleccion
                            key={o.valor}
                            etiqueta={o.etiqueta}
                            seleccionado={o.seleccionada}
                            onSeleccionar={o.onSeleccionar}
                          />
                        ))}
                        {editando === 'fecha' && (
                          <input
                            type="date"
                            aria-label="Elegir otra fecha"
                            value={fecha}
                            max={hoy}
                            onChange={(e) => {
                              if (esFechaISOValida(e.target.value)) {
                                setValue('fecha', fechaISO(e.target.value));
                                setEditando(null);
                              }
                            }}
                            className="rounded-[10px] border border-borde bg-superficie px-3 py-[7px] text-[13px] text-tinta outline-none focus:border-verde"
                          />
                        )}
                      </div>
                    )}
                    {notaEdicion[editando] !== '' && (
                      <p className="text-[11px] leading-[1.5] font-light text-tenue">
                        {notaEdicion[editando]}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {hayError ? (
                <div
                  role="alert"
                  className="mt-auto flex flex-col gap-2.5 rounded-xl border border-burdeos bg-superficie p-4"
                >
                  <p className="font-serif text-sm text-tinta">
                    No hemos podido guardar el apunte.
                  </p>
                  <p className="text-[11.5px] leading-[1.5] text-tenue">
                    Tus datos siguen aquí: {resumenLegible}. Nada se ha perdido.
                  </p>
                  <div className="flex gap-2">
                    <Boton
                      type="button"
                      onClick={() => void handleSubmit(onEnviar)()}
                      disabled={enviando}
                      className="flex-1"
                    >
                      Reintentar
                    </Boton>
                    <Boton
                      type="button"
                      variante="secundario"
                      onClick={onDescartarError}
                      className="flex-1"
                    >
                      Seguir editando
                    </Boton>
                  </div>
                </div>
              ) : (
                <div className="mt-auto flex flex-col gap-2.5">
                  {erroresVisibles.length > 0 && (
                    <div
                      role="alert"
                      className="flex flex-col gap-1.5 rounded-xl border border-burdeos bg-superficie p-3"
                    >
                      <p className="font-serif text-sm text-tinta">
                        Falta algo para poder guardarlo.
                      </p>
                      <ul className="flex flex-col gap-0.5">
                        {erroresVisibles.map(({ campo, mensaje }) => (
                          <li key={campo} className="text-[11.5px] leading-[1.5] text-tenue">
                            {ETIQUETA_CAMPO[campo] ?? campo}: {mensaje}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <Boton type="submit" disabled={enviando}>
                    Guardar
                  </Boton>
                </div>
              )}
            </div>
          )}
        </FlujoPorPasos>
      </form>
    );
  },
);
FormularioAltaRapida.displayName = 'FormularioAltaRapida';
