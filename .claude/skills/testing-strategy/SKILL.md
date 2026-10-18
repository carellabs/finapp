---
name: testing-strategy
description: "Trigger: tests, vitest, fast-check, property-based, Postgres efimero en Docker, Playwright, cobertura, mutation testing, Stryker, fixtures. Estrategia de testing de FinApp; condición de cada commit."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract

Leer ANTES de escribir cualquier test, tocar la configuración de CI o cerrar una fase. **Testing no es una fase final: es una condición de cada commit.**

## Hard Rules

1. **TDD en dominio, objetivos e insights: primero el test, después el código.** Sin excepción.
2. **Cada bug se arregla con un test de regresión primero** que reproduzca el fallo, y luego el fix. Cada vulnerabilidad, igual.
3. **Prohibido mockear el driver de Postgres.** Los bugs de este proyecto viven en el SQL y en los tipos numéricos: un mock los oculta. Integración contra un Postgres real y efímero levantado por `npm run test:integration`.
4. **Prohibido depender de la fecha real del sistema.** El `Clock` se inyecta y se congela. Un test que falla el día 1 de mes es un test roto.
5. **Sin tests `skip` en `main`.** Un test desactivado es una mentira verde.
6. **Property-based obligatorio en el dominio del dinero** (fast-check). Los tests con ejemplos concretos dejan pasar los errores de redondeo.
7. Ninguna fase se cierra con tests en rojo, lint con warnings o gates por debajo del umbral.
8. **Los tests que lanzan procesos hijo llevan timeout propio** (`TIMEOUT_TEST_PROCESO_MS` = 90 s, en `api/tests/soporte/ejecutar-script.ts`): con la máquina cargada un `node` tarda decenas de segundos. `api/tests/config/procesos-con-timeout.test.ts` lo exige. El resto de los tests se rige por el timeout global de `web` y `api` (15 s por test; `shared` e integración, los suyos): es un margen frente a la saturación de la máquina, medido, no una licencia para tests lentos; un test normal que se cuelga sigue fallando en segundos. **Un timeout solo se sube con medida**: el tiempo del test en máquina libre y bajo carga (p. ej. 12 y 36 procesos de CPU en bucle, con `PID` guardados y matados por PID), y la medida va en un comentario junto al valor.
9. **Una espera con sondeo no lleva un tope fijo en segundos**: espera a un hecho (p. ej. que la operación en vuelo termine sin haber llegado al bloqueo) y deja el límite al timeout del test; un tope fijo hace el test dependiente de la velocidad de la máquina.

## Decision Gates

| Qué pruebo | Nivel | Herramienta |
|---|---|---|
| función pura de dominio, objetivos o insights | unitario (mayoría) | Vitest |
| invariante que debe cumplirse con CUALQUIER entrada | property-based | fast-check |
| repositorio o endpoint | integración | Supertest + Postgres efímero en Docker |
| flujo que no puede romperse | E2E (pocos) | Playwright |
| que los tests detectan cambios reales | mutación | Stryker sobre `/shared` |

## Umbrales de CI

| Gate | Umbral | Cuándo corre |
|---|---|---|
| Cobertura `/shared` | **90 %** | cada push |
| Cobertura `api` | **80 %** | cada push |
| Mutation score `/shared` | **75 %** | PRs que tocan `/shared` + nightly; **bloquea el merge a main** |
| Lint / typecheck / build | 0 errores, 0 warnings | cada push |

Stryker no corre en cada push a propósito: tarda minutos y un gate que estorba acaba desactivado, y un gate desactivado es peor que no tenerlo.

## Execution Steps

1. Escribe el test que falla. Ejecútalo y **comprueba que falla por el motivo correcto**.
2. Implementa lo mínimo para que pase.
3. Añade la property si el cálculo involucra dinero.
4. Pega la salida real del runner en el chat: no vale resumir que "funciona".

## Output Contract

Una fase cerrada aporta: salida real de `test`, `lint` y `build`, más la cobertura de las capas afectadas.

## References

- `references/tests-obligatorios.md` — lista de tests exigidos por fase y fixtures
