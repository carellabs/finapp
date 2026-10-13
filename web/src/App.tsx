import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { RouterProvider, type createBrowserRouter } from 'react-router';
import { queryCliente } from './lib/query-cliente';
import { router as routerPorDefecto } from './lib/router';

interface PropiedadesApp {
  /** El cliente de consultas y el enrutador entran por props: los tests no
   *  comparten caché ni estado de navegación entre sí. */
  clienteConsultas?: QueryClient;
  enrutador?: ReturnType<typeof createBrowserRouter>;
}

export function App({
  clienteConsultas = queryCliente,
  enrutador = routerPorDefecto,
}: PropiedadesApp) {
  return (
    <QueryClientProvider client={clienteConsultas}>
      <RouterProvider router={enrutador} />
    </QueryClientProvider>
  );
}
