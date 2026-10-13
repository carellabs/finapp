import { formatearMes, mesCobertura } from '@finapp/shared';
import { ChipSeleccion } from '../atoms/ChipSeleccion';

interface PropiedadesSelectorMes {
  meses: readonly string[];
  valor: string;
  onCambiar: (mes: string) => void;
}

/** Presentacional: cambia el mes visible del Dashboard sin recargar la página. */
export function SelectorMes({ meses, valor, onCambiar }: PropiedadesSelectorMes) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {meses.map((mes) => (
        <ChipSeleccion
          key={mes}
          etiqueta={formatearMes(mesCobertura(mes))}
          seleccionado={mes === valor}
          onSeleccionar={() => onCambiar(mes)}
        />
      ))}
    </div>
  );
}
