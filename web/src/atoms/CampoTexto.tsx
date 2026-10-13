import { forwardRef, useId, type InputHTMLAttributes } from 'react';

interface PropiedadesCampoTexto extends InputHTMLAttributes<HTMLInputElement> {
  etiqueta: string;
  error?: string | undefined;
}

export const CampoTexto = forwardRef<HTMLInputElement, PropiedadesCampoTexto>(
  ({ etiqueta, error, id, className = '', ...resto }, ref) => {
    const idGenerado = useId();
    const idCampo = id ?? idGenerado;
    const idError = `${idCampo}-error`;

    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={idCampo} className="text-sm text-tenue">
          {etiqueta}
        </label>
        <input
          id={idCampo}
          ref={ref}
          aria-invalid={error !== undefined}
          aria-describedby={error !== undefined ? idError : undefined}
          className={`rounded-[10px] border border-borde bg-superficie px-3 py-2.5 text-tinta outline-none focus:border-verde ${className}`}
          {...resto}
        />
        {error !== undefined && (
          <p id={idError} role="alert" className="text-sm text-burdeos">
            {error}
          </p>
        )}
      </div>
    );
  },
);
CampoTexto.displayName = 'CampoTexto';
