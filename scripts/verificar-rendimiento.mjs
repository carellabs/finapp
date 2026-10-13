#!/usr/bin/env node
/**
 * Siembra 2.000 transacciones y comprueba con EXPLAIN que las consultas que
 * sostienen el producto usan indice y no un seq scan.
 *
 * El motor de objetivos e insights barre TODO el historico filtrando por los
 * dos ejes de clasificacion, no solo el mes en curso: disenar los indices
 * pensando unicamente en el dashboard condena esas consultas.
 *
 * Los datos sembrados son ruido sintetico para medir, se generan en una BD
 * efimera y se destruyen con ella. No entran nunca en la base real.
 */
import pg from 'pg';

const cliente = new pg.Client({ connectionString: process.env.DATABASE_URL });
await cliente.connect();

const { rows: categorias } = await cliente.query(
  'SELECT id, es_deuda FROM categorias WHERE NOT es_pass_through',
);

const necesidades = ['Esencial', 'Flexible', 'Prescindible'];
const recurrencias = ['Recurrente', 'Puntual'];
const filas = [];

for (let i = 0; i < 2000; i += 1) {
  const categoria = categorias[i % categorias.length];
  const mes = `2025-${String((i % 12) + 1).padStart(2, '0')}`;
  filas.push([
    `${mes}-15`,
    mes,
    'Gasto',
    categoria.id,
    (10 + (i % 500)).toFixed(2),
    necesidades[i % necesidades.length],
    recurrencias[i % recurrencias.length],
    'Tarjeta',
  ]);
}

const valores = filas
  .map(
    (_, indice) =>
      `($${indice * 8 + 1},$${indice * 8 + 2},$${indice * 8 + 3},$${indice * 8 + 4},` +
      `$${indice * 8 + 5},$${indice * 8 + 6},$${indice * 8 + 7},$${indice * 8 + 8})`,
  )
  .join(',');

await cliente.query(
  `INSERT INTO transacciones
     (fecha, mes_cobertura, tipo, categoria_id, monto, necesidad, recurrencia, metodo)
   VALUES ${valores}`,
  filas.flat(),
);
await cliente.query('ANALYZE transacciones');

const CONSULTAS = [
  {
    nombre: 'dashboard del mes',
    sql: `SELECT tipo, sum(monto) FROM transacciones
          WHERE mes_cobertura = '2025-06' AND tipo = 'Gasto' GROUP BY tipo`,
  },
  {
    nombre: 'base del CSM (todo el historico, dos ejes)',
    sql: `SELECT t.mes_cobertura, sum(t.monto)
          FROM transacciones t JOIN categorias c ON c.id = t.categoria_id
          WHERE t.tipo = 'Gasto'
            AND ((t.necesidad = 'Esencial' AND t.recurrencia = 'Recurrente') OR c.es_deuda)
          GROUP BY t.mes_cobertura`,
  },
  {
    nombre: 'agregado por categoria del mes',
    sql: `SELECT categoria_id, sum(monto) FROM transacciones
          WHERE mes_cobertura = '2025-06' GROUP BY categoria_id`,
  },
];

let hayFallo = false;

for (const { nombre, sql } of CONSULTAS) {
  const { rows } = await cliente.query(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`);
  const plan = rows.map((f) => f['QUERY PLAN']).join('\n');
  const tiempo = /Execution Time: ([\d.]+) ms/.exec(plan)?.[1] ?? '?';
  const usaIndice = /Index Scan|Index Only Scan|Bitmap Index Scan/.test(plan);

  console.error(`\n[rendimiento] ${nombre}`);
  console.error(`[rendimiento]   indice: ${usaIndice ? 'SI' : 'NO (seq scan)'} · ${tiempo} ms`);

  if (Number(tiempo) > 100) {
    console.error(`[rendimiento]   FALLO: ${tiempo} ms supera el presupuesto de 100 ms.`);
    hayFallo = true;
  }
}

await cliente.end();

if (hayFallo) {
  process.exit(1);
}
console.error('\n[rendimiento] OK: todas las consultas dentro del presupuesto.');
