import { QueryClient } from '@tanstack/react-query';

export const queryCliente = new QueryClient({
  defaultOptions: {
    queries: {
      // Un 401 (sin sesión) o 422 (validación) no se arregla reintentando.
      retry: 1,
      staleTime: 30_000,
    },
    mutations: {
      retry: 0,
    },
  },
});
