import { crearApp } from './app';
import { cargarEnv } from './config/env';
import { crearPool } from './db/cliente';

const env = cargarEnv();
const pool = crearPool(env.DATABASE_URL);
const app = crearApp(env, pool);

const servidor = app.listen(env.PORT, () => {
  console.error(JSON.stringify({ nivel: 'info', mensaje: 'api escuchando', puerto: env.PORT }));
});

async function apagar(): Promise<void> {
  servidor.close();
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => void apagar());
process.on('SIGINT', () => void apagar());
