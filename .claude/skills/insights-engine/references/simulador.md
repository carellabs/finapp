# Simulador "¿y si...?"

## Contrato

Se ejecuta **en el cliente**, sobre datos ya cargados. Sin ida y vuelta al servidor: la respuesta debe ser inmediata mientras se arrastra el slider.

Reutiliza **exactamente las mismas funciones puras** de `/shared/src/insights` y `/shared/src/objetivos` que usa la API. Si alguna vez hay dos implementaciones del mismo cálculo, una de las dos ya está mal.

## Entradas

- Ajuste por categoría: `categoria_id → factor` (0 a 1,5).
- Ajuste por eje: `necesidad → factor` (solo `Flexible` y `Prescindible`; `Esencial` no se simula a la baja, porque no es negociable por definición).

## Salidas en tiempo real

| Salida | Cálculo |
|---|---|
| ahorro mensual simulado | ahorro neto recalculado con los factores aplicados |
| ahorro anualizado | delta mensual × 12 |
| meses de fondo cubiertos | `ahorro_acumulado / CSM_simulado` |
| fecha estimada de consecución | `deficit_simulado / ritmo_simulado` |

## Reglas duras

1. El simulador **no persiste nada**. Es una proyección visual; no crea transacciones ni modifica objetivos.
2. Si el escenario simulado produce `ritmo_ahorro <= 0`, se aplica la misma regla que en producción: **no se muestra fecha**, se muestra el aviso.
3. Los factores aplicados se muestran siempre junto al resultado. Un número sin su supuesto es un número inventado.
4. El estado base del simulador es siempre el dato real: al soltar los sliders vuelve a la realidad, no a un escenario recordado.
