import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fechaISO } from '@finapp/shared';
import { ListaObjetivosSecundarios } from '../../src/features/objetivos/ListaObjetivosSecundarios';

/**
 * Issue #29. `guardar()` hace `zNuevoObjetivo.parse(...)` dentro del `onSubmit`: con el tope de
 * importes, un importe mayor lanzaría un `ZodError` en un manejador de React (sin `fetch`, sin
 * mensaje, botón "Añadir" muerto). El paso de importe no deja llegar ahí: avisa y no deja continuar.
 */
function renderizar() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <ListaObjetivosSecundarios objetivos={[]} hoy={fechaISO('2026-08-05')} />
    </QueryClientProvider>,
  );
}

function teclear(texto: string): void {
  for (const tecla of texto) fireEvent.click(screen.getByRole('button', { name: tecla }));
}

/** Abre el flujo, pone un nombre y llega al paso del importe. */
function llegarAlImporte(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Añadir objetivo' }));
  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Viaje' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ListaObjetivosSecundarios: importe por encima del tope de la API', () => {
  it('10.000.000.000,00 €: el aviso sale en el paso del importe y no se puede continuar', () => {
    const fetchEspia = vi.fn();
    vi.stubGlobal('fetch', fetchEspia);
    renderizar();
    llegarAlImporte();

    teclear('10000000000');

    expect(screen.getByRole('alert')).toHaveTextContent(
      /El importe no puede superar 9\.999\.999\.999,99\s€/,
    );
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    expect(fetchEspia).not.toHaveBeenCalled();
  });

  it('9.999.999.999,99 € (el tope exacto) llega al resumen sin aviso (control positivo)', () => {
    renderizar();
    llegarAlImporte();

    teclear('9999999999,99');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sin fecha' }));

    expect(screen.getByRole('button', { name: 'Añadir' })).toBeEnabled();
  });
});
