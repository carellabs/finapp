import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PanelTransaccionesCategoria } from '../../src/features/dashboard/PanelTransaccionesCategoria';
import type { CategoriaApi } from '../../src/features/categorias/usar-categorias';
import type { TransaccionApi } from '../../src/features/transacciones/usar-transacciones';

function respuestaJson(status: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CATEGORIA_ID = '11111111-1111-4111-8111-111111111111';

const TRANSACCION: TransaccionApi = {
  id: 'tx-1',
  fecha: '2026-08-01',
  mesCobertura: '2026-08',
  tipo: 'Gasto',
  categoriaId: CATEGORIA_ID,
  montoCents: 4260,
  direccion: null,
  subtipo: null,
  necesidad: 'Esencial',
  recurrencia: 'Recurrente',
  metodo: 'Tarjeta',
  descripcion: null,
  prestamoId: null,
  deudaId: null,
  origenId: null,
  creadoEn: '2026-08-01T00:00:00Z',
  actualizadoEn: '2026-08-01T00:00:00Z',
};

const CATEGORIAS: readonly CategoriaApi[] = [
  {
    id: CATEGORIA_ID,
    nombre: 'Alimentación - Supermercado',
    esPassThrough: false,
    esDeuda: false,
    activa: true,
  },
];

function renderizar() {
  const clienteConsultas = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={clienteConsultas}>
      <PanelTransaccionesCategoria
        categoriaId={CATEGORIA_ID}
        nombreCategoria="Alimentación - Supermercado"
        mes="2026-08"
        categorias={CATEGORIAS}
        onCerrar={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe('PanelTransaccionesCategoria', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tocar el chip de necesidad avanza al siguiente valor del ciclo (Esencial → Flexible)', async () => {
    let cuerpoEnviado: unknown;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const metodo = init?.method ?? 'GET';
        if (metodo === 'GET' && url.includes('/transacciones')) {
          return Promise.resolve(respuestaJson(200, { data: [TRANSACCION] }));
        }
        if (metodo === 'PATCH' && url.includes(`/transacciones/${TRANSACCION.id}`)) {
          cuerpoEnviado = JSON.parse(init?.body as string);
          return Promise.resolve(respuestaJson(200, { data: TRANSACCION }));
        }
        throw new Error(`fetch no esperado: ${metodo} ${url}`);
      }),
    );

    renderizar();

    const chipNecesidad = await screen.findByRole('button', { name: 'Esencial' });
    fireEvent.click(chipNecesidad);

    await waitFor(() => {
      expect(cuerpoEnviado).toMatchObject({ necesidad: 'Flexible' });
    });
  });

  it('el ciclo de recurrencia vuelve al principio al llegar al final (Puntual → Recurrente)', async () => {
    let cuerpoEnviado: unknown;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const metodo = init?.method ?? 'GET';
        if (metodo === 'GET' && url.includes('/transacciones')) {
          return Promise.resolve(
            respuestaJson(200, { data: [{ ...TRANSACCION, recurrencia: 'Puntual' }] }),
          );
        }
        if (metodo === 'PATCH' && url.includes(`/transacciones/${TRANSACCION.id}`)) {
          cuerpoEnviado = JSON.parse(init?.body as string);
          return Promise.resolve(respuestaJson(200, { data: TRANSACCION }));
        }
        throw new Error(`fetch no esperado: ${metodo} ${url}`);
      }),
    );

    renderizar();

    const chipRecurrencia = await screen.findByRole('button', { name: 'Puntual' });
    fireEvent.click(chipRecurrencia);

    await waitFor(() => {
      expect(cuerpoEnviado).toMatchObject({ recurrencia: 'Recurrente' });
    });
  });
});
