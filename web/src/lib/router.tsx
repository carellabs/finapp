import { createBrowserRouter, Navigate, Outlet } from 'react-router';
import { EstadoCarga } from '../atoms/EstadoCarga';
import { EstadoError } from '../atoms/EstadoError';
import { useSesion } from '../features/auth/usar-auth';
import { IniciarSesion } from '../features/auth/IniciarSesion';
import { EsqueletoApp } from '../features/layout/EsqueletoApp';
import { AltaRapida } from '../features/alta-rapida/AltaRapida';
import { Dashboard } from '../features/dashboard/Dashboard';
import { Objetivos } from '../features/objetivos/Objetivos';
import { Analisis } from '../features/analisis/Analisis';
import { ErrorPeticion } from './api-cliente';

/**
 * Comprueba la sesión antes de renderizar nada protegido (`GET /auth/me`).
 * Un 401 es una respuesta válida ("no autenticado", nunca un error) y
 * redirige a /login; cualquier otro fallo (red caída, 500) muestra un error
 * real en vez de expulsar en silencio a un usuario con sesión válida.
 */
function RutaProtegida() {
  const { isLoading, isError, error } = useSesion();

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <EstadoCarga etiqueta="Comprobando sesión…" />
      </div>
    );
  }

  if (isError) {
    if (error instanceof ErrorPeticion && error.status === 401) {
      return <Navigate to="/login" replace />;
    }
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <EstadoError mensaje="No se pudo conectar con el servidor. Comprueba tu conexión." />
      </div>
    );
  }

  return <Outlet />;
}

/** Fábrica, no singleton importado a secas: cada test necesita su propia instancia. */
export function crearRouter() {
  return createBrowserRouter([
    { path: '/login', element: <IniciarSesion /> },
    {
      element: <RutaProtegida />,
      children: [
        {
          element: <EsqueletoApp />,
          children: [
            { index: true, element: <Navigate to="/alta" replace /> },
            { path: 'alta', element: <AltaRapida /> },
            { path: 'dashboard', element: <Dashboard /> },
            { path: 'objetivos', element: <Objetivos /> },
            { path: 'analisis', element: <Analisis /> },
          ],
        },
      ],
    },
  ]);
}

/** Instancia real de la aplicación (main.tsx). */
export const router = crearRouter();
