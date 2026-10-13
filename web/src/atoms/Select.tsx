import { forwardRef, useId, type SelectHTMLAttributes } from 'react';

interface OpcionSelect {
  valor: string;
  etiqueta: string;
}

interface PropiedadesSelect extends SelectHTMLAttributes<HTMLSelectElement> {
  etiqueta: string;
  opciones: readonly OpcionSelect[];
  placeholder?: string;
  error?: string | undefined;
}

/** Select con label asociado: la clasificación (categoría, tipo, método…) nunca es texto libre. */
export const Select = forwardRef<HTMLSelectElement, PropiedadesSelect>(
  ({ etiqueta, opciones, placeholder, error, id, className = '', ...resto }, ref) => {
    const idGenerado = useId();
    const idCampo = id ?? idGenerado;
    const idError = `${idCampo}-error`;

    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={idCampo} className="text-sm text-tenue">
          {etiqueta}
        </label>
        <select
          id={idCampo}
          ref={ref}
          aria-invalid={error !== undefined}
          aria-describedby={error !== undefined ? idError : undefined}
          className={`rounded-[10px] border border-borde bg-superficie px-3 py-2.5 text-tinta outline-none focus:border-verde ${className}`}
          {...resto}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {opciones.map((opcion) => (
            <option key={opcion.valor} value={opcion.valor}>
              {opcion.etiqueta}
            </option>
          ))}
        </select>
        {error !== undefined && (
          <p id={idError} role="alert" className="text-sm text-burdeos">
            {error}
          </p>
        )}
      </div>
    );
  },
);
Select.displayName = 'Select';
