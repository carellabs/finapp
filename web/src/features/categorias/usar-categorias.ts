import { useQuery } from '@tanstack/react-query';
import { apiCliente } from '../../lib/api-cliente';

export interface CategoriaApi {
  id: string;
  nombre: string;
  esPassThrough: boolean;
  esDeuda: boolean;
  activa: boolean;
}

/** Categorías activas, ordenadas por nombre (igual que el propio backend las devuelve). */
export function useCategorias() {
  return useQuery({
    queryKey: ['categorias'],
    queryFn: () => apiCliente.get<CategoriaApi[]>('/categorias'),
    // Las categorías cambian muy poco: no merece la pena refetchear a cada rato.
    staleTime: 5 * 60_000,
  });
}
