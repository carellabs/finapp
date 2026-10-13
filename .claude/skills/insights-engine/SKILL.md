---
name: insights-engine
description: "Trigger: insights, conclusiones, tendencias, suscripciones, outliers, simulador, umbrales de suficiencia. Motor de análisis de FinApp; leer antes de emitir cualquier conclusión."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract

Leer ANTES de escribir, modificar o emitir cualquier insight, tendencia, proyección intra-mes, detección de patrones o cálculo del simulador "¿y si...?".

## Hard Rules

1. **Reglas deterministas, nunca machine learning.** Toda conclusión debe poder justificarse con aritmética sobre los datos del usuario.
2. **Un insight sin `evidencia` numérica no es un insight: no se emite.** La evidencia son importes, meses y transacciones concretas.
3. **Si un insight no alcanza su umbral de suficiencia, se muestra qué falta** ("necesitas 2 meses más de registro para esto"). Prohibido emitir una conclusión débil disfrazada de certeza.
4. **Nunca se compara contra benchmarks externos, medias nacionales ni perfiles genéricos.** Solo contra el propio histórico del usuario.
5. **La app no da consejo financiero ni recomienda productos.** Describe patrones y sus consecuencias aritméticas. Un insight jamás especula sobre causas que no estén en los datos.
6. **Una función pura por insight, en `/shared/src/insights`.** Se ejecutan también en el navegador para el simulador: enterrarlas en la capa de servicios del backend obliga a duplicarlas y garantiza que las dos copias divergirán.
7. El orquestador ejecuta todos y **devuelve solo los que superan su umbral**, ordenados por severidad.

## Decision Gates — umbrales de suficiencia

| Meses cerrados | Qué se permite emitir |
|---|---|
| `< 2` | solo insights descriptivos del mes en curso · cero tendencias, comparativas o proyecciones |
| `2–4` | tendencias y proyecciones marcadas `provisional`, con aviso de muestra corta |
| `>= 5` | `suficiente` |

## Execution Steps

1. Test primero. Cada insight necesita un test de "se emite", uno de "no se emite por umbral" y uno de "evidencia no vacía".
2. Implementa la función pura: entrada = transacciones + presupuestos + `Clock`; salida = `Insight | null`.
3. Registra la función en el orquestador con su umbral y su regla de severidad.
4. Verifica que la evidencia devuelta reproduce la cifra del título. Si no cuadran, el insight está mal.

## Output Contract

```ts
type Insight = {
  id: string
  titulo: string            // la conclusión en una frase, lenguaje directo
  evidencia: Evidencia[]    // cifras concretas; NUNCA vacío
  suficiencia: 'suficiente' | 'provisional' | 'insuficiente'
  accion_sugerida?: string  // solo si se deduce de los datos
  severidad: 'informativo' | 'atencion' | 'critico'
}
```

## References

- `references/catalogo-insights.md` — los 13 insights con su regla exacta, umbral y severidad
- `references/simulador.md` — contrato del simulador "¿y si...?"
