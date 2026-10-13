import { useNavigate } from 'react-router';
import type { LoginEntrada } from '@finapp/shared';
import { ErrorPeticion } from '../../lib/api-cliente';
import { useLogin } from './usar-auth';
import { FormularioIniciarSesion } from './FormularioIniciarSesion';

function mensajeDeError(error: unknown): string | undefined {
  if (error === null || error === undefined) return undefined;
  if (error instanceof ErrorPeticion && error.status === 401) {
    return 'Usuario o contraseña incorrectos';
  }
  return 'No se pudo conectar con el servidor';
}

/** Container: resuelve la mutación de login y navega al éxito. */
export function IniciarSesion() {
  const navigate = useNavigate();
  const login = useLogin();

  function manejarEnvio(datos: LoginEntrada): void {
    login.mutate(datos, {
      onSuccess: () => {
        // `navigate()` puede devolver una Promise (View Transitions); el
        // callback de `onSuccess` espera `void`, así que se descarta aquí.
        void navigate('/', { replace: true });
      },
    });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="font-serif text-2xl text-tinta">FinApp</h1>
        <p className="text-sm text-tenue">Inicia sesión para continuar</p>
      </div>
      <FormularioIniciarSesion
        onEnviar={manejarEnvio}
        enviando={login.isPending}
        error={mensajeDeError(login.error)}
      />
    </main>
  );
}
