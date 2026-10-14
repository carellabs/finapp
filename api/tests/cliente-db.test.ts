import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { crearPool } from '../src/db/cliente';
import type { EventoRegistro } from '../src/infra/registro';

/** `getTypeParser` está tipado como `any` en `pg`: lo acotamos aquí. */
type Parser = (valor: string) => unknown;

const parserDe = (oid: number): Parser => pg.types.getTypeParser(oid) as Parser;

describe('parsers de tipos de Postgres', () => {
  it('DATE llega como string, no como Date: un Date se desplazaría de día', () => {
    const valor = parserDe(pg.types.builtins.DATE)('2026-01-01');

    expect(valor).toBe('2026-01-01');
    expect(valor).not.toBeInstanceOf(Date);
  });

  it('el último día de mes tampoco se desplaza', () => {
    const parser = parserDe(pg.types.builtins.DATE);

    expect(parser('2026-06-30')).toBe('2026-06-30');
    expect(parser('2026-12-31')).toBe('2026-12-31');
  });

  it('NUMERIC llega como string: convertirlo a number reintroduce el error de coma flotante', () => {
    const valor = parserDe(pg.types.builtins.NUMERIC)('1438.50');

    expect(typeof valor).toBe('string');
    expect(valor).toBe('1438.50');
  });
});

describe('crearPool', () => {
  it('crea un pool sin conectar todavía', async () => {
    const pool = crearPool('postgresql://finapp:clave@127.0.0.1:1/finapp');

    expect(pool.totalCount).toBe(0);
    await pool.end();
  });

  it('el error de un cliente ocioso se registra y no tumba el proceso', async () => {
    // Si la base de datos se reinicia, los clientes ociosos del pool emiten `error`; un
    // `EventEmitter` sin escuchador lo relanza y el proceso muere.
    const eventos: EventoRegistro[] = [];
    const pool = crearPool('postgresql://finapp:clave@127.0.0.1:1/finapp', (e) => eventos.push(e));
    const error = Object.assign(new Error('terminating connection (clave secreta de ejemplo)'), {
      code: '57P01',
    });

    expect(() => pool.emit('error', error)).not.toThrow();

    expect(eventos).toEqual([
      expect.objectContaining({ nivel: 'error', error: 'Error', codigo: '57P01' }),
    ]);
    // Sin datos sensibles: ni el mensaje ni la URL de conexión.
    expect(JSON.stringify(eventos)).not.toContain('secreta');
    expect(JSON.stringify(eventos)).not.toContain('clave');
    await pool.end();
  });
});
