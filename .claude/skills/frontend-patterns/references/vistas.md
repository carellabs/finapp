# Las cuatro vistas

Cada vista responde a **una** pregunta. Si un elemento no ayuda a responderla, no pertenece a esa vista.

## a) Alta rápida — *"¿cómo apunto esto sin pensar?"*

La más usada y la que sostiene todo el sistema: **si registrar cuesta, el sistema se abandona y lo demás sobra.**

- Mobile-first, objetivo **menos de 10 segundos** por alta.
- Wizard por pasos (`FlujoPorPasos`, mecánica "1b"): una pregunta a la vez — tipo → importe → categoría/dirección → resumen —, lo respondido se apila arriba en tarjetas finas y editables con un toque. Cero `<select>`, cero texto libre: tipo, categoría, método, necesidad, recurrencia y dirección son tarjetas o chips.
- Solo 3 preguntas obligatorias para un gasto (tipo, importe, categoría); lo demás (necesidad, recurrencia, método, fecha, mes de cobertura) se precarga por categoría (`lib/preferencias-categoria.ts`: semilla + lo último usado en `localStorage`) y se edita como chip en el resumen si hace falta corregirlo.
- `fecha` por defecto hoy.
- `mes_cobertura` autocompletado a partir de la fecha, **con opción visible de sobrescribir** (es el caso de la nómina del día 30).
- Feedback optimista con **reversión** si la API falla: se vuelve al paso de resumen con una tarjeta de error (borde `burdeos`), no un banner suelto. Nunca un spinner bloqueante.
- Los campos que no aplican al tipo elegido desaparecen (`necesidad` solo en Gasto, `direccion` solo en Transferencia).

## b) Dashboard — *"¿cómo voy este mes?"*

Selector de mes que actualiza todo **sin recargar**.

Orden en pantalla, de arriba abajo:
1. **Insights relevantes del mes** (la conclusión primero).
2. Tarjetas: Ingresos · Gastos · Ahorro neto · % Gasto/Ingreso · pass-through aparte.
3. Barras de gasto por categoría, **ordenadas de mayor a menor**.
4. Necesidad vs Deseo · Recurrente vs Puntual.
5. Presupuesto vs Real con semáforo (`sin_presupuesto` es un estado propio, no rojo).
6. Préstamos y deuda.

**Interactividad obligatoria:** clic en cualquier categoría o segmento abre un panel con las transacciones que lo componen, **con edición de la clasificación in situ** — reclasificar debe ser trivial porque de ello depende el CSM.

## c) Objetivos — *"¿cuándo llego?"*

- Fondo de emergencia con barra de progreso (clampeada) y **meses cubiertos** (sin clampear: ahí está la verdad).
- **CSM desglosado por categoría**: el usuario tiene que poder ver de dónde sale la cifra o no se la creerá.
- Fecha estimada **o** el aviso de ritmo insuficiente con el ahorro mínimo necesario. Nunca una fecha absurda.
- Evolución histórica del objetivo y **alerta destacada si ha subido**, con la categoría que lo empujó.
- Ahorro declarado vs calculado, con la fecha de última actualización de cada uno y la divergencia si supera el umbral.
- Objetivos secundarios con su ahorro mensual necesario y si son compatibles con el ritmo actual.

## d) Análisis — *"¿qué está pasando de verdad?"*

- Insights completos **con su evidencia numérica desplegable**.
- Evolución multi-mes por categoría.
- Simulador "¿y si...?" (ver `../../insights-engine/references/simulador.md`).
- Los insights que no alcanzan su umbral aparecen como **huecos explicados**: "necesitas 2 meses más de registro para esto". El hueco informa; el silencio, no.

## Estados vacíos honestos

Con el histórico actual (registro desde junio de 2026) la vista de Análisis estará **casi vacía al arrancar** y eso es correcto. El diseño debe hacer que ese vacío se lea como "aún no hay datos suficientes", no como "la app está rota".

## PWA

Manifest + service worker registrado desde el principio (`vite-plugin-pwa`), **sin caché offline todavía**. Añadirlo después obliga a tocar el build.
