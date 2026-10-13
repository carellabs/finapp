import { Outlet, useNavigate } from 'react-router';
import { Boton } from '../../atoms/Boton';
import { NavInferior } from '../../organisms/NavInferior';
import { useLogout } from '../auth/usar-auth';

/** Container: la cabecera y el botón de salir necesitan la mutación de logout. */
export function EsqueletoApp() {
  const navigate = useNavigate();
  const logout = useLogout();

  function manejarSalir(): void {
    logout.mutate(undefined, {
      onSuccess: () => {
        void navigate('/login', { replace: true });
      },
    });
  }

  return (
    <div className="flex min-h-dvh flex-col pb-16">
      <header className="flex items-center justify-between border-b border-borde p-4">
        <span className="font-serif text-base text-tinta">FinApp</span>
        <Boton variante="secundario" onClick={manejarSalir} disabled={logout.isPending}>
          Salir
        </Boton>
      </header>
      <div className="flex-1 p-4">
        <Outlet />
      </div>
      <NavInferior />
    </div>
  );
}
