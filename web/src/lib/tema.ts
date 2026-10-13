/**
 * `index.html` ya fija `data-tema` antes del primer paint (evita el
 * parpadeo). Esto solo mantiene `data-tema` sincronizado si el sistema
 * operativo cambia de tema con la app abierta.
 */
export function observarCambiosDeTema(): () => void {
  const medios = window.matchMedia('(prefers-color-scheme: dark)');
  const aplicar = (oscuro: boolean): void => {
    document.documentElement.dataset.tema = oscuro ? 'oscuro' : 'claro';
  };
  const manejador = (evento: MediaQueryListEvent): void => aplicar(evento.matches);

  medios.addEventListener('change', manejador);
  return () => medios.removeEventListener('change', manejador);
}
