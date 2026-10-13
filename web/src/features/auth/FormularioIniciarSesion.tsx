import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { zLogin, type LoginEntrada } from '@finapp/shared';
import { Boton } from '../../atoms/Boton';
import { CampoTexto } from '../../atoms/CampoTexto';

interface PropiedadesFormularioIniciarSesion {
  onEnviar: (datos: LoginEntrada) => void;
  enviando: boolean;
  error?: string | undefined;
}

/** Presentacional puro (container/presentational): no conoce TanStack Query ni la API. */
export function FormularioIniciarSesion({
  onEnviar,
  enviando,
  error,
}: PropiedadesFormularioIniciarSesion) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginEntrada>({ resolver: zodResolver(zLogin) });

  return (
    <form
      onSubmit={(e) => void handleSubmit(onEnviar)(e)}
      className="flex flex-col gap-4"
      noValidate
    >
      <CampoTexto
        etiqueta="Usuario"
        autoComplete="username"
        error={errors.nombreUsuario?.message}
        {...register('nombreUsuario')}
      />
      <CampoTexto
        etiqueta="Contraseña"
        type="password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register('password')}
      />
      {error !== undefined && (
        <p role="alert" className="text-sm text-burdeos">
          {error}
        </p>
      )}
      <Boton type="submit" disabled={enviando}>
        {enviando ? 'Entrando…' : 'Entrar'}
      </Boton>
    </form>
  );
}
