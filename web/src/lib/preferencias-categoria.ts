import type { Necesidad, Recurrencia } from '@finapp/shared';

type Metodo = 'Tarjeta' | 'Efectivo' | 'Transferencia' | 'Domiciliacion' | 'Bizum' | 'Otro';

export interface PreferenciasCategoria {
  necesidad: Necesidad;
  recurrencia: Recurrencia;
  metodo: Metodo;
}

/**
 * Namespaced por `usuarioId`: en un dispositivo compartido, cerrar sesión y
 * que otra persona inicie la suya no debe heredar las preferencias de la
 * anterior (mismo principio que ya aplica `useLogout` al vaciar la caché de
 * TanStack Query en `usar-auth.ts`, pero `localStorage` vive fuera de esa
 * caché y no se limpiaba solo).
 */
function claveAlmacenamiento(usuarioId: string): string {
  return `finapp:alta-rapida:preferencias-categoria:${usuarioId}`;
}

const SEMILLA_DEFECTO: PreferenciasCategoria = {
  necesidad: 'Flexible',
  recurrencia: 'Puntual',
  metodo: 'Tarjeta',
};

/**
 * Semilla por categoría (handoff §2.4): valores por defecto la primera vez
 * que se usa una categoría, antes de que `localStorage` recuerde algo propio.
 * `necesidad` en "Nómina" no se usa (Ingreso no tiene ese campo) pero llevar
 * un valor no hace daño: el schema de Ingreso simplemente lo ignora.
 */
const SEMILLA_POR_NOMBRE: Record<string, PreferenciasCategoria> = {
  'Alimentación - Supermercado': {
    necesidad: 'Esencial',
    recurrencia: 'Recurrente',
    metodo: 'Tarjeta',
  },
  'Alimentación - Restaurantes / Delivery': {
    necesidad: 'Prescindible',
    recurrencia: 'Puntual',
    metodo: 'Tarjeta',
  },
  'Vivienda - Alquiler / Hipoteca': {
    necesidad: 'Esencial',
    recurrencia: 'Recurrente',
    metodo: 'Domiciliacion',
  },
  Transporte: { necesidad: 'Esencial', recurrencia: 'Recurrente', metodo: 'Tarjeta' },
  'Suministros - Luz': {
    necesidad: 'Esencial',
    recurrencia: 'Recurrente',
    metodo: 'Domiciliacion',
  },
  'Suministros - Gas / Agua': {
    necesidad: 'Esencial',
    recurrencia: 'Recurrente',
    metodo: 'Domiciliacion',
  },
  'Suscripciones - Ocio / Software': {
    necesidad: 'Prescindible',
    recurrencia: 'Recurrente',
    metodo: 'Domiciliacion',
  },
  Telecomunicaciones: { necesidad: 'Esencial', recurrencia: 'Recurrente', metodo: 'Domiciliacion' },
  Deuda: { necesidad: 'Esencial', recurrencia: 'Recurrente', metodo: 'Domiciliacion' },
  Salud: { necesidad: 'Esencial', recurrencia: 'Puntual', metodo: 'Tarjeta' },
  Ropa: { necesidad: 'Flexible', recurrencia: 'Puntual', metodo: 'Tarjeta' },
  Viajes: { necesidad: 'Flexible', recurrencia: 'Puntual', metodo: 'Tarjeta' },
  Mascota: { necesidad: 'Esencial', recurrencia: 'Recurrente', metodo: 'Tarjeta' },
  Nómina: { necesidad: 'Esencial', recurrencia: 'Recurrente', metodo: 'Transferencia' },
  Otros: SEMILLA_DEFECTO,
};

function leerAlmacen(usuarioId: string): Record<string, PreferenciasCategoria> {
  try {
    const bruto = window.localStorage.getItem(claveAlmacenamiento(usuarioId));
    if (bruto === null) return {};
    return JSON.parse(bruto) as Record<string, PreferenciasCategoria>;
  } catch {
    return {};
  }
}

/** Última preferencia usada por este usuario para esta categoría si existe; si no, la semilla por nombre. */
export function preferenciasDeCategoria(
  usuarioId: string,
  categoriaId: string,
  nombreCategoria: string,
): PreferenciasCategoria {
  const recordada = leerAlmacen(usuarioId)[categoriaId];
  if (recordada !== undefined) return recordada;
  return SEMILLA_POR_NOMBRE[nombreCategoria] ?? SEMILLA_DEFECTO;
}

/** Recuerda lo realmente usado en esta categoría para la próxima alta (handoff §2.4). */
export function recordarPreferenciasDeCategoria(
  usuarioId: string,
  categoriaId: string,
  preferencias: PreferenciasCategoria,
): void {
  try {
    const almacen = leerAlmacen(usuarioId);
    almacen[categoriaId] = preferencias;
    window.localStorage.setItem(claveAlmacenamiento(usuarioId), JSON.stringify(almacen));
  } catch {
    // localStorage puede fallar (modo privado, cuota llena): no es crítico, se sigue sin recordar.
  }
}
