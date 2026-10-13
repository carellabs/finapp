import { useQuery } from '@tanstack/react-query';
import { apiCliente } from '../../lib/api-cliente';

export interface DashboardApi {
  mes: string;
  totales: {
    ingresosCents: number;
    gastosCents: number;
    ahorroNetoCents: number;
    porcentajeGastoIngreso: number | null;
    transferenciasCents: number;
  };
  gastoPorCategoria: { categoriaId: string; nombre: string; montoCents: number }[];
  gastoPorNecesidad: { esencialCents: number; flexibleCents: number; prescindibleCents: number };
  gastoPorRecurrencia: { recurrenteCents: number; puntualCents: number };
  presupuestos: {
    categoriaId: string;
    nombre: string;
    presupuestoCents: number;
    realCents: number;
    estado: 'dentro' | 'excedido' | 'sin_presupuesto';
  }[];
  prestamos: { pendienteTotalCents: number };
  deudas: { pendienteTotalCents: number; pagoMensualTotalCents: number };
}

export function useDashboard(mes: string) {
  return useQuery({
    queryKey: ['dashboard', mes],
    queryFn: () => apiCliente.get<DashboardApi>('/dashboard', { mes }),
  });
}
