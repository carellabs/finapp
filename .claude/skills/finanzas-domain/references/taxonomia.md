# Taxonomía — enums y categorías

## Enums (cerrados, definidos UNA vez en `/shared/src/enums`)

| Enum | Valores | Aplica a |
|---|---|---|
| `tipo` | `Ingreso` · `Gasto` · `Transferencia` | todas |
| `direccion` | `entrada` · `salida` | **solo** `tipo = Transferencia` (NOT NULL ahí, NULL en el resto) |
| `subtipo_transferencia` | `pass_through` · `traspaso_ahorro` | **solo** `tipo = Transferencia` |
| `necesidad` | `Esencial` · `Flexible` · `Prescindible` | **solo** `tipo = Gasto` (NULL en el resto) |
| `recurrencia` | `Recurrente` · `Puntual` | `Gasto` e `Ingreso` |
| `metodo_pago` | `Tarjeta` · `Efectivo` · `Transferencia` · `Domiciliacion` · `Bizum` · `Otro` | todas |
| `estado_prestamo` | `activo` · `devuelto` · `incobrable` | tabla `prestamos` |

## Categorías: DATO, no enum

Las categorías de §2.8 viven en la tabla `categorias` y se referencian por `id`. **No son un enum de TypeScript**: convertirlas en enum obliga a recompilar y desplegar para renombrar o añadir una, y reintroduce la referencia por nombre que causó el bug original.

Seed inicial (configuración, no dato falso):

`Nómina` · `Vivienda - Alquiler / Hipoteca` · `Suministros - Gas / Agua` · `Suministros - Luz` · `Alimentación - Supermercado` · `Alimentación - Restaurantes / Delivery` · `Transporte` · `Salud` · `Deuda` · `Telecomunicaciones` · `Suscripciones - Ocio / Software` · `Ropa` · `Viajes` · `Mascota` · `Transferencia - Pass-through` · `Otros`

## Matriz necesidad × recurrencia

Los dos ejes son **ortogonales a propósito**. Necesidad responde "¿puedo dejar de gastarlo mañana?"; recurrencia responde "¿vuelve el mes que viene?".

| | **Recurrente** | **Puntual** |
|---|---|---|
| **Esencial** | Alquiler, luz, pago de deuda, seguro → **la base del CSM** | Reparación de la caldera, medicamento puntual |
| **Flexible** | Supermercado, transporte, telefonía | Compra de ropa necesaria de temporada |
| **Prescindible** | Suscripciones de ocio, gimnasio sin usar → **el goteo invisible** | Festival, cena de celebración, viaje |

Solo la celda **Esencial ∩ Recurrente** (más la categoría `Deuda`) entra en el Coste de Subsistencia Mensual. Una transacción mal clasificada ahí distorsiona directamente el objetivo de ahorro: por eso reclasificar debe ser trivial desde el dashboard.

## Definiciones de ingreso

- **Ingreso Recurrente** = `tipo=Ingreso` + `recurrencia=Recurrente` (nómina principal + trabajo extra regular). Base de presupuestos y objetivos.
- **Ingreso Total** = todos los `tipo=Ingreso`, excluidas transferencias.
- Presupuestos y objetivo de ahorro usan **siempre el recurrente**, para que el sistema siga siendo válido si cambia la situación laboral.
