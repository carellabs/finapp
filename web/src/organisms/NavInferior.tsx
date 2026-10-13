import { LayoutDashboard, Plus, Search, Target } from 'lucide-react';
import { NavLink } from 'react-router';

const ITEMS = [
  { ruta: '/alta', etiqueta: 'Alta', Icono: Plus },
  { ruta: '/dashboard', etiqueta: 'Panel', Icono: LayoutDashboard },
  { ruta: '/objetivos', etiqueta: 'Objetivos', Icono: Target },
  { ruta: '/analisis', etiqueta: 'Análisis', Icono: Search },
] as const;

/** Mobile-first: nav fija abajo, alcanzable con el pulgar (frontend-patterns). */
export function NavInferior() {
  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 flex border-t border-borde bg-superficie"
    >
      {ITEMS.map(({ ruta, etiqueta, Icono }) => (
        <NavLink
          key={ruta}
          to={ruta}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] tracking-[.08em] uppercase ${
              isActive ? 'text-verde' : 'text-tenue'
            }`
          }
        >
          <Icono aria-hidden="true" size={22} strokeWidth={1.4} />
          {etiqueta}
        </NavLink>
      ))}
    </nav>
  );
}
