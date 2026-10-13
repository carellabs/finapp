---
name: finanzas-domain
description: "Trigger: totales, agregados, pass-through, mes_cobertura, necesidad, recurrencia, presupuesto vigente, préstamos, deuda. Reglas de negocio de FinApp; leer antes de tocar cualquier cálculo."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract

Leer ANTES de escribir o modificar código que:
- agregue importes (totales, medias, porcentajes, agregados por categoría)
- decida a qué mes pertenece una transacción
- clasifique gasto por necesidad o recurrencia
- compare real contra presupuesto
- toque préstamos a terceros o deuda propia

## Hard Rules

1. **Agrega SIEMPRE por `mes_cobertura`, NUNCA por `fecha`.** `fecha` es forense (cuándo ocurrió); `mes_cobertura` es contable (a qué ciclo se imputa).
2. **`tipo = 'Transferencia'` se excluye de Total Ingresos, Total Gastos, Ahorro Neto y % Gasto/Ingreso.** Sin excepción, sea cual sea su `subtipo`.
3. **Un par pass-through simétrico (entrada + salida del mismo importe) es el elemento neutro de todo agregado.** Si cambia un solo céntimo, el cálculo está mal.
4. **Referencia a categoría siempre por `id` (FK).** Nunca por nombre, nunca por posición. Renombrar una categoría no altera ni un dato histórico.
5. **Presupuestos y objetivo de ahorro se calculan sobre Ingreso Recurrente**, nunca sobre Ingreso Total.
6. **Presupuesto vigente = fila explícita `(categoria_id, mes_cobertura)`.** Sin fila = sin presupuesto = sin alerta. Prohibido heredar del mes anterior.
7. **Dinero en céntimos enteros (`Cents`).** Prohibido `float` y `number` decimal. Ver `../db-conventions/SKILL.md`.
8. **Mes cerrado = `mes_cobertura` < mes actual**, según el `Clock` inyectado en zona `Europe/Madrid`. Prohibido `new Date()` directo en dominio.
9. **Si falta un dato, falla ruidosamente.** Prohibido fallback silencioso, mock o valor inventado.

## Decision Gates

| Situación | Regla |
|---|---|
| `tipo` = Ingreso / Gasto | el signo lo determina el tipo; `monto > 0` siempre |
| `tipo` = Transferencia | exige `direccion` (entrada/salida) y `subtipo` (pass_through / traspaso_ahorro); excluido de todos los totales |
| categoría = Deuda | validación fuerza `necesidad=Esencial` + `recurrente=Recurrente` |
| mes sin ingreso recurrente | `% Gasto/Ingreso = null`, nunca 0 ni Infinity |
| préstamo marcado `incobrable` | genera un Gasto real (Puntual + Prescindible) en la fecha de write-off |
| categoría sin presupuesto ese mes | estado `sin_presupuesto`, nunca `Excedido` |
| `necesidad` en un Ingreso | `null`; solo aplica a Gasto |

## Execution Steps

1. Escribe primero el test. Los casos obligatorios con cifras están en `references/casos-numericos.md`.
2. Implementa como **función pura en `/shared/src/domain`**: sin BD, sin Express, sin React. Si necesitas la BD, te falta un parámetro.
3. Excluye transferencias ANTES de agregar, nunca corrigiendo después.
4. Verifica con fast-check: `ingresos - gastos = ahorro_neto`, conmutatividad y neutralidad del pass-through.

## Output Contract

Toda función de dominio devuelve `Cents` (entero) o un objeto de `Cents`. Nunca strings formateados: el formato `es-ES` pertenece a `../frontend-patterns/SKILL.md`.

## References

- `references/casos-numericos.md` — casos límite con cifras reales y resultado esperado
- `references/taxonomia.md` — enums, categorías y matriz necesidad × recurrencia
