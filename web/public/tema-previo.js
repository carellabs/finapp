/*
 * Pre-paint: fija data-tema antes del primer render, para que no haya parpadeo de tema
 * equivocado mientras carga el modulo de React.
 *
 * Es un fichero y no un <script> en linea porque la CSP de las paginas (docker/Caddyfile) no
 * lleva 'unsafe-inline'. Se carga SINCRONO desde <head> (sin defer, async ni type="module"):
 * solo asi se ejecuta antes del primer pintado. No lleva hash en el nombre, asi que Caddy lo
 * sirve con `no-cache`.
 */
(function () {
  var oscuro = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.tema = oscuro ? 'oscuro' : 'claro';
})();
