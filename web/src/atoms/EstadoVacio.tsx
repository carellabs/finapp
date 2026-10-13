interface PropiedadesEstadoVacio {
  mensaje: string;
}

/**
 * Estado vacío explícito (frontend-patterns Hard Rule 6): explica qué falta
 * ("necesitas 2 meses más de registro"), nunca se queda en blanco sin más.
 */
export function EstadoVacio({ mensaje }: PropiedadesEstadoVacio) {
  return (
    <div className="rounded-xl border border-dashed border-borde-fuerte p-6 text-center font-serif text-sm text-tenue">
      {mensaje}
    </div>
  );
}
