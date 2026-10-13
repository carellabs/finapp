# Tests obligatorios por fase

## Fase 2 — Modelo de datos (integración)

Cada `CHECK` y cada FK debe **rechazar** datos inválidos:
- `monto <= 0` → rechazado.
- `mes_cobertura = '2026-13'` o `'Junio'` → rechazado.
- `tipo='Transferencia'` sin `direccion` → rechazado.
- `tipo='Gasto'` sin `necesidad` → rechazado.
- borrar una categoría con transacciones → rechazado (`ON DELETE RESTRICT`).
- dos presupuestos para `(categoria_id, mes_cobertura)` → rechazado.
- migraciones: aplican y **revierten** limpiamente.

## Fase 3 — Dominio (TDD, cobertura >= 90 %)

1. Pass-through simétrico no altera ningún total.
2. Nómina del día 30 con `mes_cobertura` del mes siguiente aparece en el mes correcto.
3. Mes sin ingresos → `% Gasto/Ingreso = null`, sin división por cero.
4. Presupuesto vigente correcto al consultar un mes histórico tras haberlo cambiado.
5. `0,10 + 0,20 = 0,30` exacto.
6. Renombrar una categoría no altera ningún total histórico.
7. **Property:** `ingresos - gastos = ahorro_neto` para cualquier conjunto generado.
8. **Property:** todo importe resultante tiene exactamente 2 decimales.
9. **Property:** reordenar las transacciones no cambia ningún total (conmutatividad).
10. **Property:** añadir un par pass-through simétrico no altera ningún total.

## Fase 4 — Objetivos

1. El CSM excluye `Flexible` y `Prescindible`, e incluye los pagos de deuda.
2. El margen de seguridad se aplica y es configurable; nunca 0 por defecto.
3. `ritmo_ahorro <= 0` → sin fecha, con aviso y ahorro mínimo necesario.
4. Con 1 mes de datos → `insuficiente`.
5. Subida del CSM → objetivo sube, progreso baja **y se emite la alerta con la categoría culpable**.
6. Objetivo cumplido → modo mantenimiento, sin división por cero.
7. Divergencia declarado/calculado → se señala, no se sobrescribe.
8. **Property:** `progreso_pct ∈ [0,1]` y `deficit >= 0` para cualquier entrada.

## Fase 5 — Insights

1. Con 1 mes, ningún insight de tendencia se emite.
2. Con 3 meses, las tendencias se emiten marcadas `provisional`.
3. Suscripciones: detecta un cargo idéntico 3 meses seguidos **aunque no esté marcado como recurrente**, y calcula bien el coste anual.
4. Presupuesto crónico: distingue presupuesto irreal (gasto estable) de deriva (gasto creciente).
5. Outliers: el gasto excepcional se marca y **no arrastra la media presentada**.
6. Coste de oportunidad: recortar un % del prescindible adelanta la fecha de forma aritméticamente correcta.
7. Todo insight emitido lleva `evidencia` no vacía **que reproduce la cifra del título**.

## Fase 6 — API

Por cada endpoint: camino feliz, error de validación (`422`) y **acceso sin sesión (`401`)**.
Más los tests de seguridad de `../../security-engineering/SKILL.md` §tests como código.

## Fase 7 — Frontend

- Tests de componente para los formularios (Testing Library).
- E2E Playwright: alta de transacción → aparece en el dashboard del **mes de cobertura correcto** → el drill-down de su categoría la muestra → el progreso del objetivo se actualiza.

## Fase 8 — Importación

- Ejecutar dos veces no duplica nada (`origen_id`).
- `--dry-run` no escribe y reporta filas ambiguas.
- Filas que violan las reglas de negocio se **rechazan y reportan**, nunca se "arreglan".
- **Validación cruzada:** los totales por mes coinciden con el Excel **al céntimo**; si no, el script falla y explica la diferencia.

## Fixtures

Basados en datos reales anonimizados, en `/shared/tests/fixtures`. Deben incluir los casos límite conocidos:

- nómina cobrada a fin de mes con cobertura del siguiente,
- par pass-through simétrico,
- mes con un evento puntual grande (viaje),
- mes sin ingresos,
- categoría renombrada a mitad del histórico,
- serie de 8+ meses para poder testear tendencias y suscripciones (los datos reales actuales no llegan).
