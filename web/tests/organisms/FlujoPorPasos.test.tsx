import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FlujoPorPasos } from '../../src/organisms/FlujoPorPasos';

function Wrapper({ pasoInicial = 0 }: { pasoInicial?: number }) {
  const [paso, setPaso] = useState(pasoInicial);
  const preguntas = ['¿Qué quieres registrar?', '¿Cuánto gastaste?', '¿En qué categoría?'];
  return (
    <div>
      <button type="button" onClick={() => setPaso((p) => p + 1)}>
        avanzar (test)
      </button>
      <FlujoPorPasos
        onAtras={vi.fn()}
        etiquetaContexto="Se apila lo respondido"
        pasosRespondidos={[]}
        claveAnimacion={String(paso)}
        pregunta={preguntas[paso] ?? 'sin más preguntas'}
      >
        <p>contenido del paso {paso}</p>
      </FlujoPorPasos>
    </div>
  );
}

describe('FlujoPorPasos — gestión de foco entre pasos', () => {
  it('al montar, la pregunta recibe el foco (se anuncia de entrada)', () => {
    render(<Wrapper />);
    expect(screen.getByRole('heading', { name: '¿Qué quieres registrar?' })).toHaveFocus();
  });

  it('al cambiar de paso, el foco se mueve a la pregunta nueva', () => {
    render(<Wrapper />);

    fireEvent.click(screen.getByRole('button', { name: 'avanzar (test)' }));

    expect(screen.getByRole('heading', { name: '¿Cuánto gastaste?' })).toHaveFocus();
  });

  it('la pregunta es focable por script pero queda fuera del orden de tabulación normal', () => {
    render(<Wrapper />);
    expect(screen.getByRole('heading', { name: '¿Qué quieres registrar?' })).toHaveAttribute(
      'tabindex',
      '-1',
    );
  });
});
