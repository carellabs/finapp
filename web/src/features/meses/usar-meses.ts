import { useQuery } from '@tanstack/react-query';
import { apiCliente } from '../../lib/api-cliente';

export interface MesApi {
  mes: string;
  cerrado: boolean;
}

/** Meses con datos registrados, ascendente. Alimenta el selector de mes del Dashboard. */
export function useMeses() {
  return useQuery({
    queryKey: ['meses'],
    queryFn: () => apiCliente.get<MesApi[]>('/meses'),
    staleTime: 60_000,
  });
}
