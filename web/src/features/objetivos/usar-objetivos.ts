import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NuevoObjetivoEntrada } from '@finapp/shared';
import { apiCliente } from '../../lib/api-cliente';

export interface ObjetivoSecundarioApi {
  id: string;
  nombre: string;
  importeObjetivoCents: number;
  fechaLimite: string | null;
  mensualNecesarioCents: number | null;
  compatibleConRitmoActual: boolean;
}

export interface EstadoObjetivosApi {
  csm: {
    csmCents: number;
    baseCents: number;
    desglosePorCategoria: Record<string, number>;
    mesesUsados: string[];
    suficiencia: 'suficiente' | 'provisional' | 'insuficiente';
  };
  fondoEmergencia: {
    objetivoCents: number;
    progresoPct: number;
    mesesCubiertos: number;
    deficitCents: number;
    estado: 'progreso' | 'mantenimiento';
  };
  proyeccion: {
    ritmoAhorroCents: number;
    fechaEstimada: string | null;
    mesesRestantes: number | null;
    avisoRitmoInsuficiente: boolean;
    ahorroMinimoNecesarioCents: number | null;
  };
  alertaObjetivoAlza: { subio: boolean; deltaCents: number; categoriaCulpable: string | null };
  conciliacion: {
    declaradoCents: number;
    calculadoCents: number;
    divergenciaCents: number;
    divergenciaSignificativa: boolean;
  };
  objetivosSecundarios: ObjetivoSecundarioApi[];
  objetivoMensualAhorroCents: number;
}

export function useEstadoObjetivos() {
  return useQuery({
    queryKey: ['objetivos', 'estado'],
    queryFn: () => apiCliente.get<EstadoObjetivosApi>('/objetivos/estado'),
  });
}

export function useCrearObjetivo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entrada: NuevoObjetivoEntrada) =>
      apiCliente.post<{ id: string }>('/objetivos', entrada),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['objetivos'] });
    },
  });
}

export function useEliminarObjetivo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiCliente.eliminar<void>(`/objetivos/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['objetivos'] });
    },
  });
}

export interface SaldoAhorroApi {
  id: string;
  fecha: string;
  saldoCents: number;
  nota: string | null;
}

export function useSaldosAhorro() {
  return useQuery({
    queryKey: ['saldo-ahorro'],
    queryFn: () => apiCliente.get<SaldoAhorroApi[]>('/saldo-ahorro'),
  });
}

export function useDeclararSaldo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entrada: { fecha: string; saldoCents: number; nota?: string }) =>
      apiCliente.post<SaldoAhorroApi>('/saldo-ahorro', entrada),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['saldo-ahorro'] });
      // El saldo declarado alimenta el fondo de emergencia y la conciliación.
      void queryClient.invalidateQueries({ queryKey: ['objetivos', 'estado'] });
    },
  });
}
