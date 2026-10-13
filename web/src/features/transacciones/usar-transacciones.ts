import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NuevaTransaccionEntrada } from '@finapp/shared';
import { apiCliente } from '../../lib/api-cliente';

export interface TransaccionApi {
  id: string;
  fecha: string;
  mesCobertura: string;
  tipo: string;
  categoriaId: string;
  montoCents: number;
  direccion: string | null;
  subtipo: string | null;
  necesidad: string | null;
  recurrencia: string | null;
  metodo: string;
  descripcion: string | null;
  prestamoId: string | null;
  deudaId: string | null;
  origenId: string | null;
  creadoEn: string;
  actualizadoEn: string;
}

export function useCrearTransaccion() {
  return useMutation({
    mutationFn: (entrada: NuevaTransaccionEntrada) =>
      apiCliente.post<{ id: string }>('/transacciones', entrada),
  });
}

interface FiltrosTransacciones {
  mesCobertura?: string;
  categoriaId?: string;
}

/** Lista sin paginar en la UI (a esta escala, ~60-80/mes): trae hasta 200 de una vez. */
export function useListarTransacciones(filtros: FiltrosTransacciones | null) {
  return useQuery({
    queryKey: ['transacciones', filtros],
    enabled: filtros !== null,
    queryFn: () =>
      apiCliente.get<TransaccionApi[]>('/transacciones', {
        mesCobertura: filtros?.mesCobertura,
        categoriaId: filtros?.categoriaId,
        porPagina: '200',
      }),
  });
}

export function useActualizarTransaccion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, entrada }: { id: string; entrada: NuevaTransaccionEntrada }) =>
      apiCliente.patch<TransaccionApi>(`/transacciones/${id}`, entrada),
    onSuccess: () => {
      // Reclasificar cambia el CSM, los totales por categoría y los insights:
      // se invalida todo lo que depende de transacciones, no solo la lista.
      void queryClient.invalidateQueries({ queryKey: ['transacciones'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['insights'] });
    },
  });
}
