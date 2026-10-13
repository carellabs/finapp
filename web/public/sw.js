/*
 * Service worker minimo: se instala y se activa, y NO cachea nada.
 *
 * Existe desde la fase 1 solo para que la app sea instalable y para no tener
 * que tocar el build cuando llegue la cache offline. Cachear datos financieros
 * sin una politica pensada seria peor que no tener cache.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(self.clients.claim());
});
