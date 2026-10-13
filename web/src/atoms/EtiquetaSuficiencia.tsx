type Suficiencia = 'suficiente' | 'provisional' | 'insuficiente';

interface PropiedadesEtiquetaSuficiencia {
  suficiencia: Suficiencia;
}

const ETIQUETA: Record<Suficiencia, string | null> = {
  suficiente: null,
  provisional: 'muestra corta',
  insuficiente: 'datos insuficientes',
};

/**
 * Nunca se presenta una cifra débil disfrazada de certeza (objetivos-ahorro
 * Hard Rule 6): "suficiente" no necesita etiqueta, las otras dos sí.
 */
export function EtiquetaSuficiencia({ suficiencia }: PropiedadesEtiquetaSuficiencia) {
  const texto = ETIQUETA[suficiencia];
  if (texto === null) return null;
  return (
    <span className="rounded-full bg-superficie-2 px-2 py-0.5 text-xs text-tenue">{texto}</span>
  );
}
