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
    "request_id": "3f0c6a0e-5b8e-4b53-9d3b-2f6f1d6f8a11" } }
```

`request_id` es lo único que correla la respuesta con el log. Ni rutas, ni SQL, ni versiones.

### `X-Request-Id` y `request_id`

- **Toda respuesta que genera la app** lleva la cabecera `X-Request-Id` (éxito, error, `/health`, la petición previa de CORS…): un UUID v4 generado por el servidor para **cada** petición. Lo asigna el primer middleware de la cadena (antes de `helmet`, `cors` y la comprobación de origen), así que también la llevan los 403, 404, 429 y los 400/413/415 del lector del cuerpo.
- **Lo que rechaza el parser HTTP de Node antes de entregarle la petición a Express no la lleva** ni deja línea de log: el 431 por cabeceras demasiado grandes, el 400 por HTTP mal formado y el 417. Esas respuestas las genera Node, no la app, y no hay `res.locals` donde guardar un id.
- **Nunca se acepta un id del cliente:** un `X-Request-Id` entrante se ignora (no se copia a la respuesta, al cuerpo ni al log).
- **Todo** cuerpo de error lleva `error.request_id`, igual al de la cabecera y al de todas las líneas del log de esa petición (la línea de acceso y, si la hay, la del error). Hasta ahora lo llevaban solo los que pasaban por el manejador central; el 404 de una ruta inexistente no.
- La cabecera no se expone con `Access-Control-Expose-Headers`: en producción la web y la API comparten origen y el cuerpo ya trae el id. En desarrollo (web en `:5173`, API en `:3000`) el id sigue yendo en el cuerpo.

Código por estado (lo fija el manejador central, `api/src/http/errores.ts`; el mensaje es genérico; todos llevan `request_id`):

| Estado | `codigo` | Cuándo |
|---|---|---|
| 400 | `PETICION_INVALIDA` | JSON malformado |
| 401 | `NO_AUTENTICADO` | sin sesión o sesión caducada |
| 403 | `ORIGEN_NO_PERMITIDO` | escritura que no declara salir del frontend (ver abajo) |
| 404 | `NO_ENCONTRADO` | recurso o ruta inexistente (con `request_id`, sin eco de la ruta) |
| 409 | `CONFLICTO` | violación de constraint (FK, unique), o una operación concurrente retuvo un bloqueo más de 5 s (`lock_timeout`): el cliente puede reintentar |
| 413 | `PAYLOAD_DEMASIADO_GRANDE` | cuerpo por encima del límite |
| 415 | `TIPO_NO_SOPORTADO` | `Content-Encoding` o `charset` que el lector del cuerpo no soporta |
| 422 | `VALIDACION_FALLIDA` | Zod, con `detalles` |
| 429 | `DEMASIADAS_PETICIONES` | un limitador de peticiones (el global o el de login) se ha superado; conserva `Retry-After` y las cabeceras `RateLimit-*` |
| 500 | `ERROR_INTERNO` | cualquier otro fallo |

## Origen de las peticiones que modifican datos (CSRF)

En `/api/v1`, toda petición que no sea `GET`, `HEAD` ni `OPTIONS` (`POST`, `PUT`, `PATCH`, `DELETE`…) debe declarar que sale del frontend, o recibe `403` con `codigo: "ORIGEN_NO_PERMITIDO"`. El navegador lo declara solo; ningún cliente tiene que añadir nada.

| Cabeceras de la petición | Resultado |
|---|---|
| `Origin` igual, carácter a carácter, a `ORIGEN_FRONTEND` | pasa (aunque `Sec-Fetch-Site` sea `same-site`: así llega el desarrollo si `VITE_API_URL` es absoluta, web en `:5173` y API en `:3000`; por defecto el proxy de Vite lo hace del mismo origen). En producción es `https://finanzas.carellabs.com`, y Caddy reenvía `Origin` intacto |
| `Origin` con cualquier otro valor, incluidos `null`, vacío, otro puerto o esquema, una barra final o un prefijo | `403`; `Sec-Fetch-Site` ya no se mira |
| Sin `Origin` y `Sec-Fetch-Site: same-origin` | pasa |
| Sin `Origin` y `Sec-Fetch-Site` con otro valor (`same-site`, `cross-site`, `none`, desconocido) | `403` |
| Sin ninguna de las dos | `403` (falla en cerrado: el único cliente es el navegador) |

El `403` no repite lo recibido: ni en el cuerpo ni en el log. El log del rechazo (nivel `warn`) lleva solo el método, la ruta sin consulta y dos booleanos (`origen_presente`, `sec_fetch_site_presente`), y el mismo `request_id` que el cliente. `GET`, `HEAD` y `OPTIONS` (incluida la petición previa de CORS) se tratan como métodos seguros y no se comprueban. Todo test que haga `POST`/`PUT`/`PATCH`/`DELETE` contra la app debe llevar `Origin`: `api/tests/soporte/origen.ts`.

**Ningún `GET` ni `HEAD` escribe en la base de datos.** Es una invariante y no una cortesía: la comprobación de origen no los cubre, así que un `GET` que escribiera quedaría fuera de la defensa anti-CSRF (y de un futuro usuario de base de datos de solo lectura para las lecturas). `GET /api/v1/objetivos/estado` (y su `HEAD`, que ejecuta el mismo manejador) calcula el mes en curso al vuelo y no guarda nada: solo lee la foto de cierre del mes anterior. Esa foto (`objetivo_historico`) la escribe la tarea programada `foto-mensual-objetivos` cuando el mes se cierra (ver `objetivos-ahorro`). Lo vigila `api/tests/integration/objetivos-solo-lectura.test.ts`: cada `GET` de la API, y su `HEAD`, dejan la base de datos idéntica tabla por tabla. Quien añada un `GET` lo añade a esa lista.

## Endpoints

| Método | Ruta | Notas |
|---|---|---|
| `POST` | `/api/v1/auth/login` | rate limit agresivo + bloqueo tras N fallos. Rota: revoca la sesión de la cookie `sid` previa si es del mismo usuario y se autentica bien. Deja como mucho `MAX_SESIONES_POR_USUARIO` sesiones (borra las más antiguas) |
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
| `GET` | `/api/v1/objetivos/estado` | CSM, progreso, proyección, alertas. Solo lectura: el mes en curso se calcula al vuelo y la alerta de objetivo al alza compara con la foto de cierre del mes anterior |
| `GET` | `/health` | sin sesión; sin versiones ni estado de dependencias |

## Paginación

`?pagina=1&por_pagina=50`. `por_pagina` máximo 200, validado por Zod. `meta.total` siempre presente.

## Reglas de serialización

- Importes: `*_cents` como entero. Prohibido `monto: 850.00` en JSON.
- Fechas: `YYYY-MM-DD` (string), nunca ISO con hora ni offset.
- `mes_cobertura`: `YYYY-MM`.
- `null` explícito para lo que no aplica (`% Gasto/Ingreso` sin ingresos). Prohibido omitir el campo o mandar `0`.
