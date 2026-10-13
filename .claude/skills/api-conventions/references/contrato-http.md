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
