#!/usr/bin/env node
/**
 * Comprueba que las migraciones bajan tan limpias como suben.
 *
 * Se ejecuta dentro de `con-db-test.mjs`, que ya ha aplicado el `up`. Aqui se
 * revierte todo, se verifica que no queda NADA del esquema, y se vuelve a
 * aplicar. Una migracion que no revierte es una migracion que no se puede
 * corregir sin borrar la base de datos.
 */
import pg from 'pg';
import { lanzar } from './procesos.mjs';

const urlBd = process.env.DATABASE_URL;
if (!urlBd) {
  console.error('[migraciones] FALLO: falta DATABASE_URL.');
  process.exit(1);
}

// `npm exec` es lo que hace `npx`, pero npx es un .cmd en Windows y sin shell no se ejecuta.
const migrar = (...argumentos) =>
  lanzar('npm', ['exec', '--', 'node-pg-migrate', '-m', 'migraciones', ...argumentos], {
    stdio: 'inherit',
    cwd: 'api',
    env: process.env,
  });

const cliente = new pg.Client({ connectionString: urlBd });
await cliente.connect();

const contar = async (consulta) => Number((await cliente.query(consulta)).rows[0].total);

const tablas = `
  SELECT count(*) AS total FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name <> 'pgmigrations'`;
const tipos = `
  SELECT count(*) AS total FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typtype = 'e'`;
const funciones = `
  SELECT count(*) AS total FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'`;

const trasSubir = {
  tablas: await contar(tablas),
  tipos: await contar(tipos),
  funciones: await contar(funciones),
};
console.error('[migraciones] tras UP    ->', JSON.stringify(trasSubir));

if (trasSubir.tablas === 0) {
  console.error('[migraciones] FALLO: el UP no creo ninguna tabla.');
  process.exit(1);
}

console.error('[migraciones] revirtiendo todo...');
if (migrar('down', '0').status !== 0) {
  console.error('[migraciones] FALLO: el DOWN no se completo.');
  process.exit(1);
}

const trasBajar = {
  tablas: await contar(tablas),
  tipos: await contar(tipos),
  funciones: await contar(funciones),
};
console.error('[migraciones] tras DOWN  ->', JSON.stringify(trasBajar));

const residuos = Object.entries(trasBajar).filter(([, cantidad]) => cantidad !== 0);
if (residuos.length > 0) {
  console.error(
    `[migraciones] FALLO: el DOWN dejo residuos: ${residuos.map(([k, v]) => `${k}=${v}`).join(', ')}`,
  );
  process.exit(1);
}

console.error('[migraciones] reaplicando...');
if (migrar('up').status !== 0) {
  console.error('[migraciones] FALLO: no se pudo reaplicar tras revertir.');
  process.exit(1);
}

const trasResubir = {
  tablas: await contar(tablas),
  tipos: await contar(tipos),
  funciones: await contar(funciones),
};
console.error('[migraciones] tras RE-UP ->', JSON.stringify(trasResubir));

await cliente.end();

if (JSON.stringify(trasResubir) !== JSON.stringify(trasSubir)) {
  console.error('[migraciones] FALLO: el esquema reaplicado no coincide con el original.');
  process.exit(1);
}

console.error('[migraciones] OK: suben, bajan sin residuos y vuelven a subir identicas.');
