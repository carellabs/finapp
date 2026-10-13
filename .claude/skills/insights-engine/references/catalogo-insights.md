# Catálogo de insights

Umbral = meses cerrados mínimos. Todos excluyen `tipo = Transferencia` y agregan por `mes_cobertura`.

| # | Insight | Umbral | Regla | Severidad |
|---|---|---|---|---|
| 1 | Suelo de gasto real | 1 | media de gasto `Recurrente` | informativo |
| 2 | Gasto reducible | 1 | `Flexible + Prescindible` vs total | informativo; `atencion` si < 15 % del total (poco margen de maniobra) |
| 3 | Concentración de gasto | 1 | top 3 categorías por % del total | informativo; `atencion` si una sola supera el 40 % |
| 4 | Tendencia por categoría | 3 | ver detalle abajo | `atencion`; `critico` si además excede presupuesto |
| 5 | Detección de suscripciones | 3 | ver detalle abajo | `atencion` |
| 6 | Presupuesto crónicamente excedido | 3 | excedido 3 meses seguidos | `critico` |
| 7 | Outliers | 2 | ver detalle abajo | informativo |
| 8 | Impacto de eventos puntuales | 1 | total del mes menos gasto `Puntual` | informativo |
| 9 | Velocidad de gasto intra-mes | 1 | ver detalle abajo | `atencion` si proyecta exceder; `critico` si supera el 110 % del presupuesto total |
| 10 | Progreso del fondo de emergencia | 2 | delega en `objetivos-ahorro` | informativo; `atencion` si ritmo <= 0 |
| 11 | Alerta de objetivo al alza | 2 | objetivo del mes > mes anterior | `critico` |
| 12 | Coste de oportunidad del prescindible | 2 | ver detalle abajo | informativo |
| 13 | Comparativa contra mi propia media | 3 | mes actual vs media histórica por categoría | informativo |

## Reglas con umbral numérico

Estos números son la parte que los tests fijan. Están propuestos y sujetos a revisión con datos reales en la auditoría de §9.

### 4 · Tendencia por categoría
Se emite si se cumplen las **tres** condiciones:
- 3 meses consecutivos al alza,
- variación >= 5 % cada mes,
- incremento absoluto >= 15,00 €/mes.

El tercer filtro existe para no gritar "tu gasto en Mascota sube un 300 %" cuando son 3,00 €.

### 5 · Detección de suscripciones
- misma `categoria_id`,
- importe dentro de ±2 % **o** ±1,00 € (el mayor de los dos),
- >= 3 meses consecutivos,
- se detecta **aunque no esté marcado como `Recurrente`**: ese es el punto.

Reporta el **coste anualizado**: `importe_medio × 12`. Ejemplo: `12,99 €` × 12 = `155,88 €/año`.

### 6 · Presupuesto crónicamente excedido
Excedido >= 3 meses seguidos. Distinción obligatoria:
- coeficiente de variación del gasto `< 10 %` → **presupuesto irreal** → sugerir subir el presupuesto,
- gasto creciente → **deriva de comportamiento** → sugerir recortar.

Confundir ambos casos invierte el consejo.

### 7 · Outliers
- mínimo **8 transacciones** en la categoría, si no, no se emite (con 3 datos el percentil 90 no significa nada),
- percentil 90 por *nearest-rank* (determinista y testeable),
- la media que se presenta al usuario se calcula **excluyendo** los outliers marcados, para que un gasto excepcional no se lea como hábito.

### 9 · Velocidad de gasto intra-mes
Fracción transcurrida = días transcurridos del **mes calendario homónimo** del `mes_cobertura` (para `2026-07`: del 1 al 31 de julio), aunque los ingresos de ese mes se cobrasen el 30 de junio. Los gastos se toman por `mes_cobertura`.

```
proyeccion_cierre = gasto_acumulado / fraccion_transcurrida
```

Solo se emite a partir del día 5: antes, el ruido de un único gasto grande dispara la proyección.

### 12 · Coste de oportunidad del prescindible
Simula recortes del **10 % / 25 % / 50 %** del gasto prescindible y devuelve cuántos meses se adelanta la fecha del fondo de emergencia. Requiere que exista una fecha estimada: si `ritmo_ahorro <= 0`, no se emite.

## Regla de severidad

`critico` se reserva para lo que exige una decisión ahora: presupuesto crónicamente excedido, objetivo al alza y proyección de cierre por encima del 110 % del presupuesto total. Si todo es crítico, nada lo es.
