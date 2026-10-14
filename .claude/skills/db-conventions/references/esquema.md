# Esquema — tablas, constraints e índices

Implementado en `api/migraciones/*.sql` (node-pg-migrate, con sección `Down` en cada fichero).
Claves primarias `uuid DEFAULT gen_random_uuid()`. `created_at` / `updated_at` en `timestamptz`, con trigger `establecer_updated_at()`.

Verificado: **11 tablas, 8 tipos enum, 1 función**. El `down` completo no deja residuo y el re-`up` reproduce el esquema idéntico (`npm run test:integration`).

## Enums (`0001_fundaciones.sql`)

`tipo_transaccion` · `direccion_transferencia` · `subtipo_transferencia` · `necesidad_gasto` · `recurrencia_transaccion` · `metodo_pago` · `estado_prestamo` · `tipo_objetivo`

## `categorias`

`nombre TEXT UNIQUE`, `es_pass_through BOOLEAN`, `es_deuda BOOLEAN`, `activa BOOLEAN`.

**Las banderas son la clave arquitectónica:** el motor localiza la categoría de deuda y la de pass-through por `es_deuda` / `es_pass_through`, **jamás por nombre**. Renombrar `Deuda` a `Préstamos` no puede hacer que el CSM pierda los pagos en silencio. Índices únicos parciales `categorias_unica_pass_through` y `categorias_unica_deuda` garantizan que solo exista una de cada.

Seed con las 16 categorías de §2.8. Nunca se borran: se desactivan.

## `transacciones`

| Columna | Tipo | Constraint |
|---|---|---|
| `fecha` | `date` | forense: cuándo ocurrió |
| `mes_cobertura` | `char(7)` | `CHECK` regex `^\d{4}-(0[1-9]\|1[0-2])$` |
| `tipo` | `tipo_transaccion` | |
| `categoria_id` | FK | `ON DELETE RESTRICT` |
| `monto` | `numeric(12,2)` | `CHECK (monto > 0)` |
| `direccion`·`subtipo` | enums NULL | solo en transferencias |
| `necesidad` | enum NULL | solo en gastos |
| `recurrencia` | enum NULL | en ingresos y gastos |
| `metodo` | `metodo_pago` | NOT NULL |
| `prestamo_id`·`deuda_id` | FK NULL | `ON DELETE RESTRICT` |
| `origen_id` | `text UNIQUE` | idempotencia de la importación (fase 8) |

Constraints con nombre (los tests los verifican uno a uno):

- `transferencia_exige_direccion` — `(tipo = 'Transferencia') = (direccion IS NOT NULL)`
- `transferencia_exige_subtipo` — idem con `subtipo`
- `solo_el_gasto_tiene_necesidad` — `(tipo = 'Gasto') = (necesidad IS NOT NULL)`
- `ingreso_y_gasto_exigen_recurrencia`
- `prestamo_solo_en_transferencias_o_gasto` — **ampliado en la migración `0008`**: el write-off de un préstamo incobrable (§2.7) genera un **Gasto** vinculado, no una Transferencia. La versión original (`prestamo_solo_en_transferencias`, solo Transferencia) se descubrió incompleta al conectar Fase 3 y Fase 6 de verdad: el dominio ya generaba ese Gasto con `prestamoId`, pero el `CHECK` de la Fase 2 lo rechazaba. Sigue prohibido en Ingreso.
- `deuda_solo_en_gastos`

La **igualdad** (no la implicación) fuerza las dos direcciones: una transferencia exige dirección, y ningún otro tipo puede llevarla.

### Índices

| Índice | Sostiene |
|---|---|
| `transacciones_mes_tipo` | dashboard mensual |
| `transacciones_categoria` | drill-down y agregados por categoría |
| `transacciones_csm` *(parcial, `WHERE tipo='Gasto'`)* | el cálculo del CSM sobre todo el histórico |
| `transacciones_fecha` | listado cronológico y detección de suscripciones |
| `transacciones_prestamo` *(parcial)* | pendiente de préstamos |

**Medido con 2.000 transacciones sembradas:** dashboard 0,10 ms (índice) · agregado por categoría 0,10 ms (índice) · base del CSM 0,64 ms (**seq scan**: el `OR c.es_deuda` invalida el índice compuesto). A este volumen el seq scan es el plan óptimo; si algún día molesta, la solución es reescribir la consulta como `UNION` de las dos ramas.

## `presupuestos`

`UNIQUE (categoria_id, mes_cobertura)` → `presupuesto_unico_por_categoria_y_mes`. Sin fila = sin presupuesto, **nunca** se hereda del mes anterior.

## `prestamos` · `deudas`

`devuelto` y `pendiente` **no se almacenan**: se derivan de las transacciones enlazadas. Un saldo duplicado acaba divergiendo. `deudas.saldo_inicial` es el saldo a fecha de inicio del registro en la app, no el importe original.

## `objetivos` · `objetivo_historico`

`fondo_no_lleva_importe_fijo` — el fondo de emergencia **no** puede tener `importe_objetivo`: se calcula y es móvil. Guardarlo sería congelar la cifra, que es justo lo prohibido por §3.4. Índice `objetivos_unico_fondo_activo` limita a un fondo activo.

`objetivo_historico.desglose JSONB NOT NULL` con `CHECK (jsonb_typeof(desglose) = 'object')`. Sin el desglose por categoría es imposible responder "qué categoría empujó el objetivo al alza", que es el aviso crítico de §3.4.

## `saldo_ahorro_declarado` · `configuracion`

Serie temporal del ahorro declarado (no inferido). `configuracion` clave-valor con los defaults de §3: `margen_seguridad=0.15` (nunca 0), `meses_objetivo=6`, `n_meses_csm=3`, `porcentaje_ahorro_objetivo=0.22`, umbrales de divergencia.

## `usuarios` · `sesiones`

`password_hash` (Argon2id) y `token_hash`: nunca el token en claro, para que leer la tabla no permita suplantar una sesión. `intentos_fallidos` y `bloqueado_hasta` viven en la BD para que **reiniciar el proceso no borre un bloqueo por fuerza bruta**.

Índices de `sesiones` y quién los usa (medido con 5.000 sesiones sembradas, 1.000 usuarios, ~1 % caducadas; sin índice nuevo, la purga, el límite y la rotación ya los usan):

| Índice | Sostiene |
|---|---|
| `sesiones_token_hash_key` (único) | verificar una sesión en cada petición y revocar la previa en el login |
| `sesiones_expiracion` | la purga (`DELETE … WHERE expira_en <= now()`): Index Scan, 0,2 ms |
| `sesiones_usuario` | la poda del límite por usuario: Bitmap Index Scan y un sort de como mucho N+1 filas, 0,5 ms. Un `(usuario_id, created_at)` no aporta nada: un usuario nunca tiene más de N (≤ 50) sesiones. |

## Los dos bugs que el esquema impide (§10), con test

- **`NUMERIC(12,2)` y no `float`:** `sum()` de 0,10 + 0,20 devuelve exactamente `'0.30'`. El parser de `pg` está configurado para devolver `NUMERIC` como **string**; convertirlo a `number` reintroduce el error de coma flotante.
- **`DATE` y no `TIMESTAMPTZ`:** el parser del OID 1082 (`api/src/db/cliente.ts`) devuelve la fecha tal cual. Sin él, `pg` la convierte a `Date` y el 2026-01-01 se puede leer como 2025-12-31 en Europe/Madrid, cambiando de mes de cobertura.
