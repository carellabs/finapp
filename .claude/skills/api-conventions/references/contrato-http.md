# Contrato HTTP

## Envelope

Éxito:

```json
{ "data": { "id": "…", "monto_cents": 85000 },
  "meta": { "pagina": 1, "por_pagina": 50, "total": 132 } }
```

Error:

```json
{ "error": {
    "codigo": "VALIDACION_FALLIDA",
    "mensaje": "Los datos enviados no son válidos",
    "detalles": [ { "campo": "mes_cobertura", "motivo": "formato_invalido" } ],
    "request_id": "01J…" } }
```

`request_id` es lo único que correla la respuesta con el log. Ni rutas, ni SQL, ni versiones.

Código por estado (lo fija el manejador central, `api/src/http/errores.ts`; el mensaje es genérico):

| Estado | `codigo` | Cuándo |
|---|---|---|
| 400 | `PETICION_INVALIDA` | JSON malformado |
| 401 | `NO_AUTENTICADO` | sin sesión o sesión caducada |
| 403 | `ORIGEN_NO_PERMITIDO` | escritura que no declara salir del frontend (ver abajo) |
| 404 | `NO_ENCONTRADO` | recurso o ruta inexistente |
| 409 | `CONFLICTO` | violación de constraint (FK, unique) |
| 413 | `PAYLOAD_DEMASIADO_GRANDE` | cuerpo por encima del límite |
| 415 | `TIPO_NO_SOPORTADO` | `Content-Encoding` o `charset` que el lector del cuerpo no soporta |
| 422 | `VALIDACION_FALLIDA` | Zod, con `detalles` |
| 500 | `ERROR_INTERNO` | cualquier otro fallo, con `request_id` |
| 429 | (ninguno) | lo responde `express-rate-limit` con texto plano y `Retry-After`, **sin** este sobre: discrepancia conocida con la regla 4 de `SKILL.md` |

## Origen de las peticiones que modifican datos (CSRF)

En `/api/v1`, toda petición que no sea `GET`, `HEAD` ni `OPTIONS` (`POST`, `PUT`, `PATCH`, `DELETE`…) debe declarar que sale del frontend, o recibe `403` con `codigo: "ORIGEN_NO_PERMITIDO"`. El navegador lo declara solo; ningún cliente tiene que añadir nada.

| Cabeceras de la petición | Resultado |
|---|---|
| `Origin` igual, carácter a carácter, a `ORIGEN_FRONTEND` | pasa (aunque `Sec-Fetch-Site` sea `same-site`: así llega el desarrollo, web en `:5173` y API en `:3000`) |
| `Origin` con cualquier otro valor, incluidos `null`, vacío, otro puerto o esquema, una barra final o un prefijo | `403`; `Sec-Fetch-Site` ya no se mira |
| Sin `Origin` y `Sec-Fetch-Site: same-origin` | pasa |
| Sin `Origin` y `Sec-Fetch-Site` con otro valor (`same-site`, `cross-site`, `none`, desconocido) | `403` |
| Sin ninguna de las dos | `403` (falla en cerrado: el único cliente es el navegador) |

El `403` no repite lo recibido: ni en el cuerpo ni en el log. El log del rechazo (nivel `warn`) lleva solo el método, la ruta sin consulta y dos booleanos (`origen_presente`, `sec_fetch_site_presente`), y el mismo `request_id` que el cliente. `GET`, `HEAD` y `OPTIONS` (incluida la petición previa de CORS) se tratan como métodos seguros y no se comprueban. Todo test que haga `POST`/`PUT`/`PATCH`/`DELETE` contra la app debe llevar `Origin`: `api/tests/soporte/origen.ts`.

**Excepción conocida: un `GET` que escribe.** Que `GET` y `HEAD` sean seguros es una convención del contrato, y `GET /api/v1/objetivos/estado` (también `HEAD`, que ejecuta el mismo manejador) la incumple: hace un `upsert` en `objetivo_historico` con la foto del mes actual, para compararla el mes siguiente (objetivo móvil). La comprobación de origen no lo cubre por ser `GET`. Impacto mínimo: (1) escribe solo el cálculo del mes actual con los datos que ya hay, ningún dato aportado por quien hace la petición; (2) es idempotente, repetirlo con los mismos datos deja la misma fila; (3) una petición entre sitios no lleva la cookie (`SameSite=Strict`). Queda pendiente moverlo a una escritura explícita o a un proceso programado; no se ha cambiado su semántica.

## Endpoints

| Método | Ruta | Notas |
|---|---|---|
| `POST` | `/api/v1/auth/login` | rate limit agresivo + bloqueo tras N fallos |
| `POST` | `/api/v1/auth/logout` | revoca la sesión en BD |
| `GET` | `/api/v1/categorias` | lista activa; nunca hardcodeada en el cliente |
| `GET` | `/api/v1/meses` | meses con datos + flag `cerrado` |
| `GET·POST·PATCH·DELETE` | `/api/v1/transacciones` | paginado; filtros por `mes_cobertura`, `categoria_id`, `tipo` |
| `GET·PUT·DELETE` | `/api/v1/presupuestos` | `PUT` con clave `(categoria_id, mes_cobertura)` |
| `POST` | `/api/v1/presupuestos/copiar` | copia los del mes anterior al mes indicado |
| `GET·POST·PATCH` | `/api/v1/prestamos` | `PATCH estado=incobrable` genera el Gasto de write-off |
| `GET·POST·PATCH` | `/api/v1/deudas` | `pendiente` derivado, nunca escrito |
| `GET·POST·PATCH` | `/api/v1/objetivos` | fondo de emergencia + secundarios |
| `GET·POST` | `/api/v1/ahorro-declarado` | serie temporal del saldo declarado |
| `GET` | `/api/v1/dashboard?mes=YYYY-MM` | agregados del mes |
| `GET` | `/api/v1/insights?mes=YYYY-MM` | solo los que superan su umbral |
| `GET` | `/api/v1/objetivos/estado` | CSM, progreso, proyección, alertas |
| `GET` | `/health` | sin sesión; sin versiones ni estado de dependencias |

## Paginación

`?pagina=1&por_pagina=50`. `por_pagina` máximo 200, validado por Zod. `meta.total` siempre presente.

## Reglas de serialización

- Importes: `*_cents` como entero. Prohibido `monto: 850.00` en JSON.
- Fechas: `YYYY-MM-DD` (string), nunca ISO con hora ni offset.
- `mes_cobertura`: `YYYY-MM`.
- `null` explícito para lo que no aplica (`% Gasto/Ingreso` sin ingresos). Prohibido omitir el campo o mandar `0`.
