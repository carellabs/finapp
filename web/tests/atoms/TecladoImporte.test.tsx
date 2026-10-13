import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TecladoImporte } from '../../src/atoms/TecladoImporte';

/** Envoltorio con estado propio: `TecladoImporte` es controlado, así que hay que re-renderizarlo tras cada tecla. */
function Wrapper({ inicial = '' }: { inicial?: string }) {
  const [valor, setValor] = useState(inicial);
  return (
    <div>
      <span data-testid="valor">{valor}</span>
      <TecladoImporte valor={valor} onCambiar={setValor} />
    </div>
  );
}

function pulsar(etiqueta: string): void {
  fireEvent.click(screen.getByRole('button', { name: etiqueta }));
}

function valorActual(): string {
  return screen.getByTestId('valor').textContent ?? '';
}

describe('TecladoImporte', () => {
  it('teclear dígitos va construyendo el número', () => {
    render(<Wrapper />);
    pulsar('4');
    pulsar('2');
    expect(valorActual()).toBe('42');
  });

  it('la coma decimal se añade una sola vez', () => {
    render(<Wrapper />);
    pulsar('4');
    pulsar('2');
    pulsar(',');
    pulsar(',');
    expect(valorActual()).toBe('42,');
  });

  it('nunca deja teclear más de 2 decimales', () => {
    render(<Wrapper />);
    ['4', '2', ',', '6', '0', '5'].forEach(pulsar);
    expect(valorActual()).toBe('42,60');
  });

  it('"Borrar" quita el último carácter, incluida la coma', () => {
    render(<Wrapper />);
    ['4', '2', ','].forEach(pulsar);
    expect(valorActual()).toBe('42,');
    pulsar('Borrar');
    expect(valorActual()).toBe('42');
    pulsar('Borrar');
    pulsar('Borrar');
    expect(valorActual()).toBe('');
  });

  it('un "0" inicial se reemplaza por el primer dígito, no se antepone (nunca "04")', () => {
    render(<Wrapper inicial="0" />);
    pulsar('4');
    expect(valorActual()).toBe('4');
  });

  it('desde "0" la coma sí se acepta, para empezar un decimal puro ("0,5")', () => {
    render(<Wrapper inicial="0" />);
    pulsar(',');
    pulsar('5');
    expect(valorActual()).toBe('0,5');
  });
});
