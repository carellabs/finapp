# Casos numéricos obligatorios — dominio

Todos los importes en euros; internamente son céntimos enteros. Cada caso es un test.

## 1. Pass-through simétrico es el elemento neutro

Mes `2026-06`:

| tipo | categoría | dirección | monto |
|---|---|---|---|
| Ingreso | Nómina | — | 2.400,00 |
| Gasto | Vivienda - Alquiler / Hipoteca | — | 850,00 |
| Transferencia | Transferencia - Pass-through | entrada | 700,00 |
| Transferencia | Transferencia - Pass-through | salida | 700,00 |

Esperado: Ingresos `2.400,00` · Gastos `850,00` · Ahorro neto `1.550,00` · % Gasto/Ingreso `35,42%`.

**Y exactamente los mismos cuatro valores** eliminando las dos transferencias. Esa igualdad es el test.

## 2. Nómina del día 30 cubre el mes siguiente

`fecha = 2026-06-30`, `mes_cobertura = 2026-07`, monto `2.400,00`.

- Dashboard de `2026-06`: ingresos `0,00` procedentes de esta transacción.
- Dashboard de `2026-07`: ingresos `2.400,00`.
- Agregar por `fecha` en lugar de `mes_cobertura` invierte ambos resultados: eso es el bug.

## 3. Mes sin ingresos no revienta

Gastos `400,00`, ingresos `0,00` → Ahorro neto `-400,00`, `% Gasto/Ingreso = null`.
Prohibido devolver `0`, `Infinity` o `NaN`. La UI muestra "sin ingresos registrados".

## 4. Suma de decimales exacta

`0,10 + 0,20 = 0,30` exacto (en céntimos: `10 + 20 = 30`).
Con `float` daría `0.30000000000000004`. Property test obligatorio.

## 5. Media con fracción de céntimo

Tres meses: `1.000,00` · `1.000,00` · `1.000,01`.
`(100000 + 100000 + 100001) / 3 = 100000,333…` → HALF_UP → `100000` → **1.000,00 €**.
La política de redondeo es única y está en `../../db-conventions/SKILL.md`.

## 6. Renombrar categoría no altera el histórico

`Transporte` → `Transporte y movilidad`. Todos los totales de todos los meses anteriores idénticos al céntimo. Si cambia algo, hay una referencia por nombre en el código.

## 7. Presupuesto versionado por mes

`Alimentación - Supermercado`: presupuesto `2026-06 = 350,00`, `2026-07 = 400,00`.
Consultar junio DESPUÉS de fijar el de julio devuelve `350,00`.
`2026-08` sin fila → estado `sin_presupuesto`, no `Excedido`.

## 8. Préstamo a tercero y write-off

1. Presto `300,00` → Transferencia, salida, subtipo `pass_through`, `prestamo_id = X`. Gastos del mes: sin cambios.
2. Me devuelve `150,00` → Transferencia, entrada, `prestamo_id = X`. Ingresos: sin cambios.
3. `pendiente = 150,00`. Es un activo informativo, **nunca** parte del fondo de emergencia.
4. Marco el préstamo `incobrable` → se genera **un Gasto real de 150,00** (Puntual + Prescindible) con `fecha` = fecha del write-off. Ese mes sí baja el ahorro neto.
5. Tras el write-off, `pendiente` pasa a **0,00**, no se queda en 150,00. `pendientePrestamo()` cuenta como "resuelto" tanto las Transferencia de entrada (devoluciones reales) como los Gasto vinculados al préstamo (el write-off): son motivos distintos (recuperado vs. perdido), pero los dos cierran la cuenta. Un Gasto de write-off no tiene `direccion` — ese campo solo existe en Transferencia —, así que se identifica por `tipo = 'Gasto'`, no por dirección.

## 9. Deuda propia entra en el coste de subsistencia

Pago mensual `180,00`, categoría `Deuda`. La validación lo fuerza a `Esencial + Recurrente`, así que entra en la base del CSM por la vía normal. La fórmula del CSM usa además la unión `OR categoria = Deuda` como red de seguridad frente a datos importados antes de esa validación.

## 10. Traspaso a cuenta de ahorro

`500,00` Transferencia, salida, subtipo `traspaso_ahorro`. No toca ingresos, gastos, ahorro neto ni porcentaje. El saldo de ahorro es **declarado**, no derivado de estos traspasos: ver `../../objetivos-ahorro/SKILL.md`.

## 11. Conmutatividad

Barajar el orden de entrada de cualquier conjunto de transacciones no cambia ni un céntimo de ningún agregado. Property test con fast-check.
