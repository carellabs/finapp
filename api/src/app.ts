import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { SystemClock, type Clock } from '@finapp/shared';
import type { Env } from './config/env';
import type { Pool } from './db/cliente';
import { manejadorErrores, rutaNoEncontrada } from './http/errores';
import { crearClaveCliente } from './http/ip-cliente';
import { alExcederElLimite } from './http/limite-excedido';
import { verificarOrigen } from './http/origen';
import { registrarAcceso } from './http/registro-acceso';
import { asignarRequestId } from './http/request-id';
import { crearRutasAuth } from './http/rutas/auth';
import { crearRutasCategorias } from './http/rutas/categorias';
import { crearRutasTransacciones } from './http/rutas/transacciones';
import { crearRutasPresupuestos } from './http/rutas/presupuestos';
import { crearRutasPrestamos } from './http/rutas/prestamos';
import { crearRutasDeudas } from './http/rutas/deudas';
import { crearRutasObjetivos } from './http/rutas/objetivos';
import { crearRutasSaldoAhorro } from './http/rutas/saldo-ahorro';
import { crearRutasMeses } from './http/rutas/meses';
import { crearRutasDashboard } from './http/rutas/dashboard';
import { crearRutasInsights } from './http/rutas/insights';
import { requireSession } from './auth/middleware';

export interface OpcionesRateLimit {
  readonly limitePorMinutoGlobal?: number;
  readonly limitePorVentanaLogin?: number;
  readonly ventanaLoginMs?: number;
}

/**
 * Los limitadores se crean POR LLAMADA a `crearApp`, nunca a nivel de
 * módulo: un `const` a nivel de módulo sería un contador compartido entre
 * cualquier app creada en el mismo proceso (recrear la app en un test, o en
 * un hot-reload de desarrollo, heredaría peticiones ya consumidas por otra
 * instancia). Cada app arranca con su propio contador, limpio.
 */
export function crearApp(
  env: Env,
  pool: Pool,
  opciones: OpcionesRateLimit = {},
  clock: Clock = new SystemClock(),
): Express {
  const {
    limitePorMinutoGlobal = 120,
    limitePorVentanaLogin = 10,
    ventanaLoginMs = 15 * 60_000,
  } = opciones;

  // Ambos limitadores cuentan por la IP real del cliente (ver ip-cliente.ts).
  const claveCliente = crearClaveCliente({ detrasDeProxy: env.TRUST_PROXY !== false });

  const limiteGlobal = rateLimit({
    windowMs: 60_000,
    limit: limitePorMinutoGlobal,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: claveCliente,
    handler: alExcederElLimite,
  });

  // Rate limit especifico de login, agresivo por IP. Complementa (no
  // sustituye) el bloqueo por cuenta persistido en `usuarios` (§8.1): este
  // limitador es en memoria y se resetea al reiniciar, el bloqueo por cuenta no.
  const limiteLogin = rateLimit({
    windowMs: ventanaLoginMs,
    limit: limitePorVentanaLogin,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: claveCliente,
    handler: alExcederElLimite,
  });

  const app = express();

  // Saltos de los que se acepta que reenvien la peticion; NUNCA `true` (cargarEnv
  // lo rechaza): cualquiera podria falsificar `X-Forwarded-For`.
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');
  // Lo PRIMERO de la cadena: asi llevan `X-Request-Id` y dejan linea de acceso tambien la
  // peticion previa de CORS (que `cors` contesta por si mismo), los 403 de la comprobacion de
  // origen, los 429, los 400/413/415 del lector del cuerpo y los 404. Un middleware mas abajo
  // se saltaria todo lo que se responde antes de llegar a el.
  app.use(asignarRequestId);
  app.use(registrarAcceso());
  app.use(helmet());
  // `cors` va primero: responde por si mismo a la peticion previa (OPTIONS) de cualquier origen.
  app.use(cors({ origin: env.ORIGEN_FRONTEND, credentials: true }));
  // Segunda barrera anti-CSRF (la primera es SameSite=Strict). Solo lee cabeceras, asi que va
  // ANTES de leer el cuerpo (una peticion ajena no llega a parsearse), de los limitadores (no
  // gasta los contadores del usuario ni empuja su cuenta hacia el bloqueo por intentos de
  // login) y de las rutas.
  app.use('/api/v1', verificarOrigen(env.ORIGEN_FRONTEND));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  /** Healthcheck deliberadamente mudo: sin versiones, rutas ni estado de dependencias. */
  app.get('/health', (_req, res) => {
    res.status(200).json({ estado: 'ok' });
  });

  app.use('/api/v1', limiteGlobal);
  app.use('/api/v1/auth/login', limiteLogin);
  app.use(
    '/api/v1/auth',
    crearRutasAuth(pool, env.NODE_ENV === 'production', env.MAX_SESIONES_POR_USUARIO),
  );

  // Todo lo que cuelga de /api/v1 a partir de aqui exige sesion (api-conventions
  // Hard Rule 8). Los routers anteriores (auth) ya respondieron a sus rutas y
  // nunca llegan a este middleware; el resto de /api/v1 si lo atraviesa.
  app.use('/api/v1', requireSession(pool));
  app.use('/api/v1/categorias', crearRutasCategorias(pool));
  app.use('/api/v1/transacciones', crearRutasTransacciones(pool));
  app.use('/api/v1/presupuestos', crearRutasPresupuestos(pool));
  app.use('/api/v1/prestamos', crearRutasPrestamos(pool));
  app.use('/api/v1/deudas', crearRutasDeudas(pool));
  app.use('/api/v1/objetivos', crearRutasObjetivos(pool, clock));
  app.use('/api/v1/saldo-ahorro', crearRutasSaldoAhorro(pool));
  app.use('/api/v1/meses', crearRutasMeses(pool, clock));
  app.use('/api/v1/dashboard', crearRutasDashboard(pool, clock));
  app.use('/api/v1/insights', crearRutasInsights(pool, clock));

  app.use(rutaNoEncontrada);
  app.use(manejadorErrores);

  return app;
}
