---
name: objetivos-ahorro
description: "Trigger: CSM, coste de subsistencia, fondo de emergencia, objetivo de ahorro, proyección, meses cubiertos, ahorro declarado. Reglas de objetivos de FinApp; leer antes de calcular cualquier meta."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract

Leer ANTES de tocar: CSM, fondo de emergencia, progreso, proyección de fecha, objetivos secundarios, conciliación declarado/calculado o `objetivo_historico`.

## Hard Rules

1. **El objetivo se recalcula en cada consulta. Prohibido congelar la cifra inicial.** Si sube el CSM, el objetivo sube y el progreso baja aunque el ahorro no se haya tocado. Ocultarlo transmite una falsa seguridad justo cuando la situación ha empeorado: es el peor fallo posible de esta funcionalidad.
2. **Cuando el objetivo sube respecto al mes anterior, se emite alerta obligatoria indicando la categoría que lo empujó.** Exige que `objetivo_historico` guarde el **desglose por categoría**, no solo el total.
3. **`ahorro_acumulado` es declarado por el usuario, jamás inferido.** La app calcula en paralelo la suma de ahorros netos y **señala** la divergencia. No mezcla, no sobrescribe, no elige una.
4. **`margen_seguridad` nunca es 0 por defecto** (por defecto 0,15). Es configurable, pero un fondo calculado sobre la media exacta se queda corto justo el mes en que hace falta.
5. **`ritmo_ahorro <= 0` → NO se devuelve fecha.** Ni `Infinity`, ni "nunca" disfrazado de fecha. Se devuelve el aviso y el ahorro mensual mínimo necesario para un horizonte dado.
6. **Menos de 2 meses cerrados → `suficiencia = 'insuficiente'`.** La cifra se muestra etiquetada como provisional, nunca como meta firme.
7. **Base del CSM = `(Esencial AND Recurrente) OR categoria = Deuda`**, excluyendo pass-through. `Flexible` y `Prescindible` quedan fuera: en una emergencia se recortan el primer día.
8. Todo cálculo usa `mes_cobertura` y `Cents`. Ver `../finanzas-domain/SKILL.md`.

## Decision Gates

| Condición | Resultado |
|---|---|
| meses cerrados | `<2` → `insuficiente`, sin proyección · `2–4` → `provisional` con aviso de muestra corta · `>=5` → `suficiente` |
| `ritmo_ahorro <= 0` | sin fecha · `ahorro_minimo_necesario = deficit / horizonte_meses` |
| `deficit = 0` | modo mantenimiento; vigilar si el CSM sube y vuelve a descubrirlo |
| `progreso > 1` | `progreso_pct` clampeado a 1; `meses_cubiertos` SIN clampear (la verdad está ahí) |
| objetivo secundario vs fondo | el fondo de emergencia va primero; el secundario consume la capacidad restante |
| divergencia declarado vs calculado `> max(50 €, 5%)` | se señala como posible gasto no registrado |

## Execution Steps

1. Test primero. Fórmulas resueltas con cifras en `references/formulas-y-casos-limite.md`.
2. Implementa en `/shared/src/objetivos` como funciones puras; el reloj entra por parámetro (`Clock`).
3. Persiste el objetivo calculado de cada mes cerrado en `objetivo_historico`, con desglose por categoría.
4. Property tests obligatorios: `progreso_pct ∈ [0,1]` y `deficit >= 0` para cualquier entrada.

## Output Contract

Todo resultado incluye `suficiencia: 'suficiente' | 'provisional' | 'insuficiente'` y los componentes que lo sostienen (base, margen, meses usados). Una cifra sin su desglose no se muestra en pantalla.

## References

- `references/formulas-y-casos-limite.md` — fórmulas resueltas paso a paso y casos límite
