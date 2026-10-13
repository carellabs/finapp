---
name: db-conventions
description: "Trigger: migraciones, esquema, tablas, índices, NUMERIC, DATE, node-pg-migrate, consultas SQL, céntimos. Convenciones de base de datos de FinApp; leer antes de tocar el esquema o una query."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract

Leer ANTES de crear o modificar una migración, una tabla, un índice, un repositorio o cualquier consulta SQL.

## Hard Rules

1. **Dinero en `NUMERIC(12,2)`. NUNCA `float`, `real` ni `double precision`.** Un `float` acumula errores de céntimos al sumar cientos de transacciones y el descuadre aparece meses después, sin traza.
2. **Fechas en `DATE`, sin zona horaria. NUNCA `TIMESTAMPTZ` para `fecha`.** En `Europe/Madrid` un `TIMESTAMPTZ` desplaza transacciones de día según el huso: un gasto del día 1 aparece el 31 del mes anterior y cambia de `mes_cobertura`. `TIMESTAMPTZ` solo para `created_at` / `updated_at`.
3. **`mes_cobertura CHAR(7)` con `CHECK (mes_cobertura ~ '^\d{4}-(0[1-9]|1[0-2])$')`**, indexado. String ordenable; jamás el nombre del mes en español.
4. **`snake_case`** en tablas y columnas.
5. **Migraciones reversibles. Prohibido editar una migración ya aplicada.** Un error se corrige con una migración nueva.
6. **FK a `categorias` con `ON DELETE RESTRICT`.** Borrar una categoría con histórico debe fallar, no arrastrar datos.
7. **Consultas SIEMPRE parametrizadas.** Cero concatenación de SQL, sin excepciones. Ver `../security-engineering/SKILL.md`.
8. **La conversión `NUMERIC ↔ Cents` vive en UN solo módulo** (`api/src/repositories/mappers`). Si aparece en dos sitios, uno de los dos redondeará distinto.
9. **`monto NUMERIC(12,2) NOT NULL CHECK (monto > 0)`.** El signo lo determina `tipo`, nunca el importe.

## Decision Gates

| Necesidad | Decisión |
|---|---|
| gestor de migraciones | node-pg-migrate con migraciones **SQL** (`-- Up Migration` / `-- Down Migration`). Drizzle se descartó: drizzle-kit no genera migraciones `down` |
| tipo de un importe en TS | `Cents` (entero con branded type) en `/shared`; `string` al leer de `pg` |
| redondeo | HALF_UP, solo al presentar y al persistir un derivado |
| dato calculado que se persiste | solo si es histórico inmutable (`objetivo_historico`); lo demás se recalcula |
| nuevo índice | justificarlo con `EXPLAIN ANALYZE` sobre 2.000 transacciones sembradas |

## Execution Steps

1. Escribe la migración, aplícala y **revierte** para comprobar que baja limpia.
2. Añade un test de integración que verifique que cada `CHECK` y cada FK **rechaza** datos inválidos.
3. Ejecuta `EXPLAIN ANALYZE` de la query del CSM y del dashboard antes de dar la tabla por buena.

## Output Contract

Cada migración deja: fichero SQL en `api/migraciones` con su sección `Down`, y un test de integración que verifica que el constraint **rechaza** datos inválidos. Las dos cosas en el mismo commit.

## References

- `references/esquema.md` — tablas, constraints e índices con su justificación
