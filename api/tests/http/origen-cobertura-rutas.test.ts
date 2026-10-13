import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Router, type Express } from 'express';
import { crearApp } from '../../src/app';
import { cargarEnv } from '../../src/config/env';
import { crearPool } from '../../src/db/cliente';
import { ORIGEN_FRONTEND_PRUEBAS } from '../soporte/origen';

/**
 * Cobertura de rutas de la comprobación de origen.
 *
 * Los tests de `origen-csrf.test.ts` prueban el middleware sobre unas rutas
 * elegidas a mano; este recorre TODAS las que `crearApp` registra. Si alguien
 * monta un router (o una ruta) donde `verificarOrigen` no llega, p. ej. fuera
 * de `/api/v1` o antes del middleware, una petición que modifica datos con un
 * `Origin` ajeno no recibirá 403 y este test fallará con el nombre de la ruta.
 *
 * Cómo se enumeran: Express 5 no guarda en sus capas el texto del prefijo con
 * el que se montó un router, así que no se puede reconstruir leyendo
 * `app.router.stack`. En su lugar se espían, solo mientras dura `crearApp`, los
 * dos métodos públicos con los que todo se registra, `Router.prototype.use`
 * (`app.use` delega en él) y `Router.prototype.route` (lo usan `get`, `post`…),
 * y se reconstruye el árbol.
 *
 * Nada de esto llega a la base de datos: con `Origin` ajeno el middleware
 * responde antes que ningún manejador, y con el del frontend toda petición se
 * detiene en `requireSession` (401), en la validación del login (422) o es el
 * logout sin cookie (204), que no consulta nada.
 */
const DATABASE_URL = 'postgresql://usuario:clave@db:5432/finapp';
const ORIGEN_AJENO = 'https://sitio-ajeno.example';
const UUID = '00000000-0000-4000-8000-000000000000';

const METODOS_QUE_MODIFICAN = ['post', 'put', 'patch', 'delete'] as const;
type MetodoQueModifica = (typeof METODOS_QUE_MODIFICAN)[number];
const METODOS_QUE_NO_MODIFICAN = new Set(['get', 'head', 'options']);

interface RutaDeExpress {
  readonly methods: Readonly<Record<string, boolean | undefined>>;
}

interface PrototipoDeRouter {
  use: (...argumentos: unknown[]) => unknown;
  route: (ruta: string) => RutaDeExpress;
}

type Registro =
  | { readonly tipo: 'use'; readonly ruta: unknown; readonly manejadores: readonly unknown[] }
  | { readonly tipo: 'route'; readonly ruta: string; readonly route: RutaDeExpress };

interface Superficie {
  /** Ruta completa, con los parámetros (`:id`…) ya sustituidos por un valor concreto. */
  readonly ruta: string;
  readonly metodos: readonly MetodoQueModifica[];
}

/** Crea la app anotando, router por router, todo lo que se monta en ella. */
function crearAppRegistrando(): { app: Express; registros: Map<unknown, Registro[]> } {
  const prototipo = (Router as unknown as { prototype: PrototipoDeRouter }).prototype;
  const registros = new Map<unknown, Registro[]>();
  const anotar = (router: unknown, registro: Registro): void => {
    registros.set(router, [...(registros.get(router) ?? []), registro]);
  };

  const use = prototipo.use;
  const route = prototipo.route;
  const espiaUse = vi.spyOn(prototipo, 'use').mockImplementation(function (
    this: unknown,
    ...argumentos: unknown[]
  ) {
    // Misma lectura que hace Router#use: el primer argumento es la ruta salvo que
    // sea (o empiece por) una función.
    const [primero, ...resto] = argumentos;
    const plano: unknown[] = Array.isArray(primero) ? primero.flat(Infinity) : [primero];
    const llevaRuta = typeof plano[0] !== 'function';
    anotar(this, {
      tipo: 'use',
      ruta: llevaRuta ? primero : '/',
      manejadores: (llevaRuta ? resto : argumentos).flat(Infinity),
    });
    return use.apply(this, argumentos);
  });
  const espiaRoute = vi.spyOn(prototipo, 'route').mockImplementation(function (
    this: unknown,
    ruta: string,
  ) {
    const creada = route.call(this as PrototipoDeRouter, ruta);
    anotar(this, { tipo: 'route', ruta, route: creada });
    return creada;
  });

  try {
    const env = cargarEnv({
      NODE_ENV: 'test',
      PORT: '3000',
      DATABASE_URL,
      ORIGEN_FRONTEND: ORIGEN_FRONTEND_PRUEBAS,
    });
    const app = crearApp(env, crearPool(DATABASE_URL), {
      // Muy por encima de lo que pide este test: aquí no se prueban los limitadores.
      limitePorMinutoGlobal: 100_000,
      limitePorVentanaLogin: 100_000,
    });
    return { app, registros };
  } finally {
    espiaUse.mockRestore();
    espiaRoute.mockRestore();
  }
}

const esRouter = (valor: unknown): boolean =>
  typeof valor === 'function' && Array.isArray((valor as { stack?: unknown }).stack);

function unir(prefijo: string, ruta: string): string {
  const junta = `${prefijo}/${ruta}`.replace(/\/{2,}/g, '/');
  return junta.length > 1 ? junta.replace(/\/$/, '') : junta;
}

function metodosQueModifica(methods: RutaDeExpress['methods']): MetodoQueModifica[] {
  if (methods._all === true) return [...METODOS_QUE_MODIFICAN];
  const nombres = Object.keys(methods).filter((m) => methods[m] === true);
  const desconocidos = nombres.filter(
    (m) =>
      !METODOS_QUE_NO_MODIFICAN.has(m) && !(METODOS_QUE_MODIFICAN as readonly string[]).includes(m),
  );
  if (desconocidos.length > 0) {
    // Fallar en cerrado: un método nuevo se añade aquí a propósito, no se ignora.
    throw new Error(`Método de Express que este test no sabe sondear: ${desconocidos.join(', ')}`);
  }
  return METODOS_QUE_MODIFICAN.filter((m) => methods[m] === true);
}

function sustituirParametros(ruta: string): string {
  const concreta = ruta.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, UUID);
  if (/[*()?+{}[\]\\]/.test(concreta)) {
    throw new Error(`Ruta con una sintaxis que este test no sabe sondear: ${ruta}`);
  }
  return concreta;
}

function enumerar(
  router: unknown,
  prefijo: string,
  registros: Map<unknown, Registro[]>,
  salida: Superficie[],
): void {
  for (const registro of registros.get(router) ?? []) {
    if (registro.tipo === 'route') {
      const metodos = metodosQueModifica(registro.route.methods);
      if (metodos.length > 0) {
        salida.push({ ruta: sustituirParametros(unir(prefijo, registro.ruta)), metodos });
      }
      continue;
    }

    if (typeof registro.ruta !== 'string') {
      throw new Error('Un use() con una ruta que no es un texto: este test no sabe sondearla');
    }
    const destino = unir(prefijo, registro.ruta);
    for (const manejador of registro.manejadores) {
      if (esRouter(manejador)) {
        enumerar(manejador, destino, registros, salida);
      } else if (registro.ruta !== '/') {
        // Middleware o sub-aplicación con ruta propia: puede responder a cualquier método.
        salida.push({ ruta: sustituirParametros(destino), metodos: [...METODOS_QUE_MODIFICAN] });
      }
    }
  }
}

const { app, registros } = crearAppRegistrando();
const superficie: Superficie[] = [];
enumerar((app as unknown as { router: unknown }).router, '', registros, superficie);

// Sin repetidos: varios middlewares cuelgan de la misma ruta (`/api/v1`, `/api/v1/auth/login`…).
const sondeos: (readonly [MetodoQueModifica, string])[] = [
  ...new Map(
    superficie.flatMap(({ ruta, metodos }) =>
      metodos.map((metodo) => [`${metodo} ${ruta}`, [metodo, ruta] as const] as const),
    ),
  ).values(),
];

describe('cobertura de rutas de verificarOrigen', () => {
  it('la enumeración ve las rutas de verdad (si no, los demás tests no comprobarían nada)', () => {
    const vistas = sondeos.map(([metodo, ruta]) => `${metodo.toUpperCase()} ${ruta}`);

    expect(vistas).toEqual(
      expect.arrayContaining([
        'POST /api/v1/auth/login',
        'POST /api/v1/auth/logout',
        'POST /api/v1/transacciones',
        `PATCH /api/v1/transacciones/${UUID}`,
        `DELETE /api/v1/transacciones/${UUID}`,
        'PUT /api/v1/presupuestos',
        'POST /api/v1/presupuestos/copiar',
        'POST /api/v1/objetivos',
        'POST /api/v1/saldo-ahorro',
      ]),
    );
    expect(sondeos.length).toBeGreaterThan(20);
  });

  it('ninguna ruta que modifica datos está montada fuera de /api/v1', () => {
    const fuera = sondeos
      .filter(([, ruta]) => ruta !== '/api/v1' && !ruta.startsWith('/api/v1/'))
      .map(([metodo, ruta]) => `${metodo.toUpperCase()} ${ruta}`);

    expect(fuera).toEqual([]);
  });

  it.each(sondeos)(
    '%s %s: con Origin ajeno da 403 y con el del frontend, no',
    async (metodo, ruta) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const ajeno = await request(app)[metodo](ruta).set('Origin', ORIGEN_AJENO);
      // Control: la ruta existe y responde algo distinto (401, 422 o 204), así que el 403 es del origen.
      const propio = await request(app)[metodo](ruta).set('Origin', ORIGEN_FRONTEND_PRUEBAS);

      expect(ajeno.status).toBe(403);
      expect(propio.status).not.toBe(403);
    },
  );
});
