import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EntradaImporte } from '../../src/molecules/EntradaImporte';

function Wrapper({
  inicial = '',
  onContinuar = vi.fn(),
}: {
  inicial?: string;
  onContinuar?: () => void;
}) {
  const [valor, setValor] = useState(inicial);
  return <EntradaImporte valor={valor} onCambiar={setValor} onContinuar={onContinuar} />;
}

describe('EntradaImporte', () => {
  it('el importe en vivo es una región `status` (anunciada a lectores de pantalla al cambiar)', () => {
    render(<Wrapper />);
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('0,00');
    expect(region).toHaveTextContent('€');
  });

  it('teclear actualiza la región en vivo con el importe tal como se ve', () => {
    render(<Wrapper />);
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(screen.getByRole('status')).toHaveTextContent('42');
  });

  it('"Continuar" empieza deshabilitado con importe 0 y se habilita al teclear algo', () => {
    render(<Wrapper />);
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '5' }));
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
  });

  it('"Continuar" llama a onContinuar solo cuando hay importe', () => {
    const onContinuar = vi.fn();
    render(<Wrapper onContinuar={onContinuar} />);

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(onContinuar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(onContinuar).toHaveBeenCalledTimes(1);
  });
});
