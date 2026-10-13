import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { App } from '../src/App';
import { crearRouter } from '../src/lib/router';

function respuestaJson(status: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('App', () => {
  beforeEach(() => {
    // Cada test arranca en "/": el router es una fábrica nueva por test, pero
    // lee `window.location` al construirse, y jsdom conserva la URL entre tests.
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sin sesión, GET /auth/me devuelve 401 y la app redirige a inicio de sesión', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          respuestaJson(401, { error: { codigo: 'NO_AUTENTICADO', mensaje: 'No autenticado' } }),
        ),
      ),
    );

    render(<App clienteConsultas={new QueryClient()} enrutador={crearRouter()} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'FinApp' })).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Usuario')).toBeInTheDocument();
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument();
  });

  it('si el servidor no responde, muestra un error real en vez de expulsar en silencio', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network down'))),
    );

    render(<App clienteConsultas={new QueryClient()} enrutador={crearRouter()} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/no se pudo conectar/i);
    });
  });

  it('con sesión válida, muestra la app con la navegación inferior', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(respuestaJson(200, { data: { autenticado: true } }))),
    );

    render(<App clienteConsultas={new QueryClient()} enrutador={crearRouter()} />);

    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: 'Navegación principal' })).toBeInTheDocument();
    });
  });
});
