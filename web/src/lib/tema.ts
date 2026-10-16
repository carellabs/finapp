/**
 * Mantiene `data-tema` en `<html>` al día con el esquema de color del sistema.
 *
 * `public/tema-previo.js` ya lo fija antes del primer pintado (evita el parpadeo), pero es un
 * fichero aparte y puede no cargar (red, caché rota, un bloqueador): por eso se aplica también
 * el valor INICIAL, no solo los cambios. Es idempotente con lo que ya hizo el script.
 */
export function observarCambiosDeTema(): () => void {
  const medios = window.matchMedia('(prefers-color-scheme: dark)');
  const aplicar = (oscuro: boolean): void => {
    document.documentElement.dataset.tema = oscuro ? 'oscuro' : 'claro';
  };
  const manejador = (evento: MediaQueryListEvent): void => aplicar(evento.matches);

  aplicar(medios.matches);
  medios.addEventListener('change', manejador);
  return () => medios.removeEventListener('change', manejador);
}
