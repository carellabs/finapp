---
name: api-conventions
description: "Trigger: endpoint, ruta, Express, Zod, validación, respuesta HTTP, error, paginación, /api/v1, DTO. Convenciones de API de FinApp; leer antes de crear o tocar un endpoint."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract

Leer ANTES de crear o modificar una ruta, un middleware, un DTO, un esquema de validación o un formato de respuesta.

## Hard Rules

1. **Todo bajo `/api/v1`.** El versionado se decide ahora, no cuando duela.
2. **Zod en el borde de TODA entrada**: body, params, query y headers relevantes. Lo que no valida, no entra. Los esquemas viven en `/shared/src/schemas` y los usan también los formularios del frontend: una sola fuente de verdad.
3. **Por API es imposible guardar un valor de enum o una categoría inválidos.** Los enums se validan contra la lista de `/shared`; `categoria_id` se valida contra la BD.
4. **Respuesta uniforme.** Éxito: `{ data, meta? }`. Error: `{ error: { codigo, mensaje, request_id, detalles? } }`. Nunca los dos. Toda respuesta que genera la app lleva además la cabecera `X-Request-Id`, y es la misma que `request_id` (las que rechaza el parser HTTP de Node antes de llegar a Express no la llevan: ver `references/contrato-http.md`).
5. **Cero stack traces, rutas de fichero, versiones o nombres de tabla en las respuestas.** El detalle va al log estructurado; al cliente le llega un mensaje genérico y un `codigo`. Ver `../security-engineering/SKILL.md`.
6. **Los importes viajan como enteros de céntimos** en un campo con sufijo explícito (`monto_cents`), nunca como decimal en JSON. El formato `es-ES` es cosa del frontend. **Todo importe de entrada tiene tope:** `MAX_IMPORTE_CENTS` (`@finapp/shared`, 999 999 999 999 céntimos = 9.999.999.999,99 €), que sale de la precisión de las columnas `numeric(12, 2)`. Lo aplican `zMontoCents` y `zMontoCentsNoNegativo`: un campo de importe nuevo usa uno de los dos, nunca un `z.number()` suelto (un test escanea los esquemas). Por encima del tope, 422 con `detalles` `[{ campo, motivo }]` y el motivo en español, sin el valor recibido.
7. **La capa HTTP no calcula nada financiero.** Valida, llama a un caso de uso y serializa. Toda la aritmética vive en `/shared`.
8. **Todo endpoint exige sesión válida**, salvo `POST /auth/login` y `GET /health`.

## Decision Gates

| Situación | Código |
|---|---|
| creación correcta | `201` + recurso en `data` |
| lectura correcta | `200` |
| borrado correcto | `204`, sin cuerpo |
| validación Zod fallida | `422` + `detalles` con `campo` y `motivo` por cada error |
| JSON malformado | `400` |
| sin sesión o sesión caducada | `401` (nunca datos, nunca `403` disfrazado) |
| recurso inexistente | `404` |
| importe por encima de `MAX_IMPORTE_CENTS` | `422` por Zod, con el campo. Segunda barrera: si un `22003` (`numeric_value_out_of_range`) llegara a Postgres, el manejador central responde `422` `VALIDACION_FALLIDA` SIN `detalles` y lo registra como `error` (es un validador que dejó pasar un valor; el mapeo es por código y habla de un «valor numérico», no de dinero), sin el `detail` de Postgres ni en la respuesta ni en el log |
| violación de constraint (FK, unique) | `409` con `codigo` semántico, nunca el error crudo de Postgres |
| body sobredimensionado | `413` |
| rate limit superado | `429` + `Retry-After` |
| fallo no controlado | `500` con `codigo` genérico (todo error lleva `request_id` para correlar con el log) |

## Execution Steps

1. Define el esquema Zod en `/shared/src/schemas` y deriva el tipo con `z.infer`. Nunca escribas la interfaz a mano en paralelo.
2. Monta la ruta: `validate(schema)` → caso de uso → serializador.
3. Escribe tres tests por endpoint: camino feliz, error de validación y **acceso sin sesión**.
4. Comprueba que el endpoint no acepta ningún dato que viole `../finanzas-domain/SKILL.md`.

## Output Contract

Un endpoint no se da por terminado sin: esquema Zod compartido, los tres tests, y su entrada en `references/contrato-http.md`.

## References

- `references/contrato-http.md` — envelope, catálogo de endpoints y formato de error
