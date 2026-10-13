import { ChevronLeft } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { PasoApilado } from '../atoms/PasoApilado';

interface PasoRespondido {
  clave: string;
  etiqueta: string;
  valor: string;
  onIr: () => void;
}

interface PropiedadesFlujoPorPasos {
  onAtras: () => void;
  etiquetaContexto: string;
  pasosRespondidos: readonly PasoRespondido[];
  /** Cambia en cada paso para que la animación de entrada se repita al remontar. */
  claveAnimacion: string;
  pregunta?: string;
  children: ReactNode;
}

/**
 * Contenedor genérico de la mecánica "apiladas" (handoff 1b): pinta la pila
 * de pasos ya respondidos y el paso actual con su animación. Reutilizable por
 * cualquier flujo de captura por pasos (alta rápida, conciliación, objetivo).
 */
export function FlujoPorPasos({
  onAtras,
  etiquetaContexto,
  pasosRespondidos,
  claveAnimacion,
  pregunta,
  children,
}: PropiedadesFlujoPorPasos) {
  const refPregunta = useRef<HTMLHeadingElement>(null);

  // Sin esto, cambiar de paso no se anuncia a quien usa lector de pantalla:
  // el DOM cambia pero el foco se queda donde estaba. Mover el foco a la
  // pregunta (con tabIndex=-1: focable por script, fuera del tab normal) hace
  // que se lea la nueva pregunta en cuanto aparece, igual que ya se ve.
  useEffect(() => {
    refPregunta.current?.focus();
  }, [claveAnimacion]);

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2.5">
        <button
          type="button"
          onClick={onAtras}
          className="flex items-center gap-1.5 border-0 bg-transparent p-0.5 text-[13px] text-tenue"
        >
          <ChevronLeft aria-hidden="true" size={16} />
          Atrás
        </button>
        <span className="text-[10px] tracking-[.16em] text-tenue uppercase">
          {etiquetaContexto}
        </span>
      </div>

      {pasosRespondidos.length > 0 && (
        <div className="flex flex-col gap-1.5 px-4 pb-3.5">
          {pasosRespondidos.map((p) => (
            <PasoApilado key={p.clave} etiqueta={p.etiqueta} valor={p.valor} onIr={p.onIr} />
          ))}
        </div>
      )}

      <div
        key={claveAnimacion}
        className="flex flex-1 flex-col gap-2.5 px-4 pb-4 [animation:entra-paso_.2s_cubic-bezier(.2,.8,.2,1)]"
      >
        {pregunta !== undefined && (
          <h2
            ref={refPregunta}
            tabIndex={-1}
            className="font-serif text-[19px] leading-[1.25] font-medium text-tinta [text-wrap:pretty]"
          >
            {pregunta}
          </h2>
        )}
        {children}
      </div>
    </div>
  );
}
