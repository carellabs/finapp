interface PropiedadesEstadoError {
  mensaje: string;
}

/** Estado de error explícito (frontend-patterns Hard Rule 6): nunca un fallo silencioso. */
export function EstadoError({ mensaje }: PropiedadesEstadoError) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-burdeos bg-superficie p-4 font-serif text-sm text-tinta"
    >
      {mensaje}
    </div>
  );
}
