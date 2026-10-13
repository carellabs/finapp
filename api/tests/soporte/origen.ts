import request from 'supertest';
import type { Express } from 'express';

/**
 * El `ORIGEN_FRONTEND` de los entornos de prueba (el servidor de desarrollo de
 * Vite). Los tests lo pasan a `cargarEnv`, y es el `Origin` que ponen los
 * clientes de este fichero.
 */
export const ORIGEN_FRONTEND_PRUEBAS = 'http://localhost:5173';

/**
 * Cliente de prueba que se comporta como el navegador de la app: `fetch()`
 * pone `Origin` en toda petición que modifica datos (Fetch Standard §3.2),
 * y la API rechaza con 403 las que no lo traen. Igual que `request(app)`, no
 * guarda cookies entre peticiones.
 *
 * Para probar la propia comprobación de origen (cabeceras ajenas o ausentes)
 * se usa `request(app)` a secas: ver `tests/http/origen-csrf.test.ts`.
 */
export function desdeElFrontend(app: Express) {
  const cliente = request(app);
  return {
    get: (ruta: string) => cliente.get(ruta).set('Origin', ORIGEN_FRONTEND_PRUEBAS),
    post: (ruta: string) => cliente.post(ruta).set('Origin', ORIGEN_FRONTEND_PRUEBAS),
    put: (ruta: string) => cliente.put(ruta).set('Origin', ORIGEN_FRONTEND_PRUEBAS),
    patch: (ruta: string) => cliente.patch(ruta).set('Origin', ORIGEN_FRONTEND_PRUEBAS),
    delete: (ruta: string) => cliente.delete(ruta).set('Origin', ORIGEN_FRONTEND_PRUEBAS),
  };
}

/** Como `desdeElFrontend`, pero conservando las cookies entre peticiones (`request.agent`). */
export function agenteDesdeElFrontend(app: Express): ReturnType<typeof request.agent> {
  return request.agent(app).set('Origin', ORIGEN_FRONTEND_PRUEBAS);
}
