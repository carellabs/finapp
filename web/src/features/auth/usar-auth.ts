import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LoginEntrada } from '@finapp/shared';
import { apiCliente } from '../../lib/api-cliente';

interface AutenticadoRespuesta {
  autenticado: boolean;
  /** Clave opaca de partición para datos del lado del cliente (p.ej. `localStorage`); nunca para autorización. */
  usuarioId: string;
}

const CLAVE_SESION = ['auth', 'me'] as const;

/** `GET /auth/me`: 200 con sesión válida, 401 (isError) sin ella o expirada. */
export function useSesion() {
  return useQuery({
    queryKey: CLAVE_SESION,
    queryFn: () => apiCliente.get<AutenticadoRespuesta>('/auth/me'),
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (credenciales: LoginEntrada) =>
      apiCliente.post<AutenticadoRespuesta>('/auth/login', credenciales),
    onSuccess: (datos) => {
      queryClient.setQueryData(CLAVE_SESION, datos);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiCliente.post<void>('/auth/logout'),
    onSuccess: () => {
      // Limpia TODA la caché, no solo la sesión: los datos financieros del
      // usuario anterior no deben sobrevivir ni un instante al logout.
      // `clear()` NO relanza por sí solo la query de sesión que sigue
      // montada en `RutaProtegida`; por eso quien llama a `mutate` navega a
      // /login explícitamente (igual que hace login con "/"), en vez de
      // depender de que la ruta protegida reaccione sola a la caché vacía.
      queryClient.clear();
    },
  });
}
