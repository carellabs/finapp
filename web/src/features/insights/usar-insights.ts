import { useQuery } from '@tanstack/react-query';
import type { Evidencia, Insight } from '@finapp/shared';
import { apiCliente } from '../../lib/api-cliente';

export type { Evidencia, Insight };

export function useInsights(mes: string) {
  return useQuery({
    queryKey: ['insights', mes],
    queryFn: () => apiCliente.get<Insight[]>('/insights', { mes }),
  });
}
