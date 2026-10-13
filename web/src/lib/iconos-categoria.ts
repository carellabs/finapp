import {
  ArrowLeftRight,
  Banknote,
  Bus,
  Droplet,
  Ellipsis,
  HeartPulse,
  House,
  Landmark,
  PawPrint,
  Plane,
  Repeat,
  Shirt,
  ShoppingBasket,
  Utensils,
  Wifi,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * El icono es puramente cosmético: se empareja por `nombre` (no hay flag de
 * icono en `categorias`). A diferencia de `es_pass_through`/`es_deuda`, que
 * existen justamente para que renombrar una categoría NUNCA altere un
 * cálculo (migración 0002), aquí no hay cálculo en juego — solo el dibujo.
 */
const ICONO_POR_NOMBRE: Record<string, LucideIcon> = {
  Nómina: Banknote,
  'Vivienda - Alquiler / Hipoteca': House,
  'Suministros - Gas / Agua': Droplet,
  'Suministros - Luz': Zap,
  'Alimentación - Supermercado': ShoppingBasket,
  'Alimentación - Restaurantes / Delivery': Utensils,
  Transporte: Bus,
  Salud: HeartPulse,
  Deuda: Landmark,
  Telecomunicaciones: Wifi,
  'Suscripciones - Ocio / Software': Repeat,
  Ropa: Shirt,
  Viajes: Plane,
  Mascota: PawPrint,
  Otros: Ellipsis,
  'Transferencia - Pass-through': ArrowLeftRight,
};

export function iconoDeCategoria(nombre: string): LucideIcon {
  return ICONO_POR_NOMBRE[nombre] ?? Ellipsis;
}

/** Etiqueta corta para la rejilla de categorías (handoff §1.4): no siempre coincide con `nombre`. */
const ETIQUETA_CORTA_POR_NOMBRE: Record<string, string> = {
  Nómina: 'Nómina',
  'Vivienda - Alquiler / Hipoteca': 'Vivienda',
  'Suministros - Gas / Agua': 'Gas y agua',
  'Suministros - Luz': 'Luz',
  'Alimentación - Supermercado': 'Supermercado',
  'Alimentación - Restaurantes / Delivery': 'Restaurantes',
  Transporte: 'Transporte',
  Salud: 'Salud',
  Deuda: 'Deuda',
  Telecomunicaciones: 'Telecom',
  'Suscripciones - Ocio / Software': 'Suscripciones',
  Ropa: 'Ropa',
  Viajes: 'Viajes',
  Mascota: 'Mascota',
  Otros: 'Otros',
  'Transferencia - Pass-through': 'Transferencia',
};

export function etiquetaCortaCategoria(nombre: string): string {
  return ETIQUETA_CORTA_POR_NOMBRE[nombre] ?? nombre;
}

const FRECUENTES_POR_TIPO: Record<'Gasto' | 'Ingreso', readonly string[]> = {
  Gasto: [
    'Alimentación - Supermercado',
    'Alimentación - Restaurantes / Delivery',
    'Vivienda - Alquiler / Hipoteca',
    'Transporte',
    'Suministros - Luz',
    'Suscripciones - Ocio / Software',
  ],
  Ingreso: ['Nómina', 'Otros'],
};

/** Categorías frecuentes por tipo, en el orden fijo de §2.4 del handoff. */
export function categoriasFrecuentes<T extends { nombre: string }>(
  categorias: readonly T[],
  tipo: 'Gasto' | 'Ingreso',
): T[] {
  const porNombre = new Map(categorias.map((c) => [c.nombre, c]));
  return FRECUENTES_POR_TIPO[tipo]
    .map((nombre) => porNombre.get(nombre))
    .filter((c): c is T => c !== undefined);
}
