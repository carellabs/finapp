---
name: frontend-patterns
description: "Trigger: React, componente, vista, dashboard, formulario, Tailwind, Recharts, formato es-ES, Intl, mobile-first, accesibilidad, PWA. Patrones de frontend de FinApp."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract

Leer ANTES de crear o modificar cualquier componente, vista, formulario, gráfica o formato de presentación.

## Hard Rules

1. **Cuatro vistas. Ni una más:** Alta rápida · Dashboard · Objetivos · Análisis. Cada pantalla responde a **una** pregunta concreta.
2. **Si una métrica no cambia una decisión, no va en pantalla.** Un dashboard que crece sin control acaba siendo un dashboard que se deja de mirar.
3. **La conclusión primero, el detalle después.** Los insights van arriba, antes de las tablas.
4. **Formato `es-ES` siempre vía `Intl`** (`1.234,56 €`, `DD/MM/YYYY`). Prohibida la concatenación manual de strings de moneda o fecha (única excepción: el eco en vivo del teclado numérico de `TecladoImporte`, que necesita mostrar un decimal a medio teclear — usa `lib/importe-parcial.ts`, nunca lo repliques a mano en otro sitio).
5. **Nada de texto libre, y tampoco `<select>`, donde la respuesta es una de pocas opciones.** Categoría, tipo, método, necesidad, recurrencia y dirección son tarjetas, rejillas o chips (`TarjetaOpcion`, `RejillaOpciones`, `ChipSeleccion`, `ChipEditable`) — nunca un `<select>` nativo ni un `<input type="text">`. El texto libre es la puerta de entrada de los datos sucios que arruinaron la hoja de cálculo original; el `<select>` es una capa de fricción que la identidad 1b (ver §Identidad visual) elimina. Texto libre que queda en la app, y punto: el nombre de un objetivo secundario, y el concepto/descripción opcional de una transacción (chip "Añadir concepto" en el resumen de Alta rápida — campo real de dominio, no un select disfrazado). `atoms/Select.tsx` sigue existiendo solo para la reclasificación de categoría en `PanelTransaccionesCategoria` (una lista potencialmente larga no cabe bien en chips); no lo uses en nada nuevo.
6. **Estados de carga, error y vacío explícitos en cada vista.** El estado vacío explica qué falta ("necesitas 2 meses más de registro"), no se queda en blanco.
7. **Prohibido `dangerouslySetInnerHTML`.**
8. **Container / presentational:** los componentes de presentación no llaman a la API ni conocen TanStack Query. Reciben datos por props.
9. **Los cálculos financieros se importan de `/shared`**, jamás se reimplementan en el componente.
10. **Nada en línea en el HTML ni en el DOM: la CSP de producción no lleva `'unsafe-inline'`** (la fija Caddy). Prohibidos `<script>` o `<style>` en línea en `index.html` (el script del tema es `public/tema-previo.js`, síncrono en `<head>`), atributos `on*`, `style=""` en el marcado, `setAttribute('style', …)`, `<style>` creados a mano, `eval`/`new Function` y URLs `javascript:`. La prop `style` de React vale (va por CSSOM). Nada inlinado como `data:` (`assetsInlineLimit: 0`): un icono o una fuente va como fichero. En desarrollo no hay CSP: lo que la rompa solo falla en producción, por eso lo vigilan el lint (`eslint.config.js`, sobre `web/src`: `no-eval`, `no-new-func`, `no-script-url`, y `no-restricted-syntax` contra `setAttribute('style'|'on…')`, `createElement('style'|'script')`, `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`, `dangerouslySetInnerHTML` y `<style>`/`<script>` en JSX) y `web/tests/despliegue/index-html.test.ts` (el HTML).
11. **La web llama a la API por la ruta relativa `/api/v1`** (`lib/api-cliente.ts`): en producción y en desarrollo comparten origen (en desarrollo, el servidor de Vite hace de proxy de `/api`, `vite.proxy.ts`). Ninguna URL absoluta a la API en el código; `VITE_API_URL` solo la cambia a mano en desarrollo sin proxy.

## Identidad visual

Estas reglas son la capa de tokens de `estilos.css` — no las reinventes por pantalla.

- **Colores por significado, nunca por hex crudo.** `papel`/`superficie`/`superficie-2` (fondos), `tinta`/`tenue` (texto), `borde`/`borde-fuerte`; acentos `verde` (acción, "va bien"), `tabaco` (flexible), `oro` (atención/divergencia), `burdeos` (excedido/error), `neutro` (estado propio — "sin presupuesto" — nunca alerta). Máximo 2 fondos por pantalla (`papel` + `superficie`).
- **No negociable: los estados semánticos son borde + texto, nunca relleno de color.** Nada de `bg-verde/15` ni similares para un chip o badge de estado — nunca vas a ver eso en este código. Las barras de magnitud (gasto por categoría) van en un solo tono, nunca un color por categoría.
- **Tipografía por rol, no por gusto:** EB Garamond (`font-serif`) para preguntas, títulos y **todas las cifras de dinero**; Jost (por defecto, `font-sans`) para etiquetas, microcopy, botones y navegación. `font-variant-numeric: tabular-nums` ya viene puesto globalmente — no lo repitas por componente.
- **Iconos: `lucide-react` siempre, nunca emoji ni SVG a mano.** `strokeWidth={1.4}`, color `verde`, 15 px en filas, 19–22 px en navegación/opciones. El mapa categoría → icono vive en `lib/iconos-categoria.ts` — amplíalo ahí, no inline.
- **Modo claro y oscuro vía `[data-tema]` en `<html>`**, no `prefers-color-scheme` directo en componentes — ya está resuelto en `estilos.css` + `lib/tema.ts`.
- **Cualquier flujo nuevo de captura por pasos** (una pregunta a la vez, con lo respondido apilado arriba) se construye sobre `organisms/FlujoPorPasos.tsx` + los átomos `TarjetaOpcion`, `RejillaOpciones`, `TecladoImporte`, `ChipSeleccion`, `ChipEditable`, `PasoApilado` — no levantes un wizard nuevo desde cero. Alta rápida, declarar saldo y objetivo secundario ya lo usan; es el patrón de referencia. `FlujoPorPasos` ya mueve el foco a la pregunta en cada cambio de paso (se anuncia solo a lectores de pantalla) — no dupliques esa lógica en el consumidor.
- **El paso de importe se construye con `molecules/EntradaImporte.tsx`** (cifra + `TecladoImporte` + Continuar), nunca repitiendo el bloque a mano: ya trae `role="status"` para que el importe se anuncie según se teclea.

## Decision Gates

| Necesidad | Decisión |
|---|---|
| estado de servidor | TanStack Query; `onMutate` + rollback para el feedback optimista del alta rápida |
| estado de UI local | `useState` / `useReducer`. Sin librería de estado global |
| estilos | Tailwind v4 con capa de tokens; mobile-first, el desktop es la excepción |
| tipografía | `font-serif` (EB Garamond) en preguntas/títulos/dinero; `font-sans` (Jost, por defecto) en el resto |
| iconos | `lucide-react`, `strokeWidth={1.4}`, color `verde`; mapeo en `lib/iconos-categoria.ts` |
| captura por pasos | `organisms/FlujoPorPasos.tsx` + átomos de tarjeta/chip — nunca `<select>` |
| gráficas | Recharts |
| formularios | react-hook-form + `zodResolver` con los esquemas de `/shared` |
| estructura | atomic design: `atoms/` `molecules/` `organisms/`, containers en `features/` |
| importes | siempre `Cents` hasta el borde; `formatearEuros()` solo en la capa de presentación |

## Execution Steps

1. Define el componente de presentación puro y su test con Testing Library.
2. Envuélvelo en un container que resuelve los datos.
3. Comprueba los tres estados (carga, error, vacío) antes de dar el componente por hecho.
4. Verifica en viewport móvil primero: el alta rápida debe completarse en **menos de 10 segundos**.

## Output Contract

Un componente no está terminado sin: los tres estados, formato `es-ES` vía `Intl`, navegación por teclado y etiquetas accesibles en todos los controles.

## References

- `references/vistas.md` — qué responde cada vista y qué contiene
