# Fórmulas resueltas y casos límite — objetivos

Ejemplo base usado en todo el documento. Hoy = `2026-07-27`. Meses cerrados: `2026-04`, `2026-05`, `2026-06` (N = 3).

## 1. Coste de Subsistencia Mensual

```
base_CSM = media mensual de gastos con
             (recurrencia = 'Recurrente' AND necesidad = 'Esencial')
             OR categoria = 'Deuda'
           excluyendo tipo = 'Transferencia'
           sobre los últimos N meses CERRADOS (N por defecto 3, mínimo 2)

CSM = base_CSM × (1 + margen_seguridad)        // margen por defecto 0,15
```

Datos: `1.420,00` · `1.385,50` · `1.510,00`

```
base = (142000 + 138550 + 151000) / 3 = 431550 / 3 = 143850  → 1.438,50 €
CSM  = 143850 × 1,15 = 165427,5 → HALF_UP → 165428           → 1.654,28 €
```

## 2. Fondo de emergencia

```
objetivo        = CSM × meses_objetivo          // por defecto 6
progreso_pct    = min(1, ahorro_acumulado / objetivo)
meses_cubiertos = ahorro_acumulado / CSM        // SIN clampear
deficit         = max(0, objetivo - ahorro_acumulado)
```

Con `ahorro_acumulado = 3.200,00` declarado:

```
objetivo        = 165428 × 6 = 992568           → 9.925,68 €
progreso_pct    = 320000 / 992568 = 0,3224      → 32,2 %
meses_cubiertos = 320000 / 165428 = 1,93        → "1,9 meses de vida cubiertos"
deficit         = 992568 - 320000 = 672568      → 6.725,68 €
```

## 3. Proyección

```
ritmo_ahorro    = media de Ahorro Neto de los últimos N meses cerrados
meses_restantes = deficit / ritmo_ahorro
fecha_estimada  = hoy + meses_restantes
```

Ahorros netos `620,00` · `410,00` · `705,00`:

```
ritmo           = (62000 + 41000 + 70500) / 3 = 173500 / 3 = 57833  → 578,33 €
meses_restantes = 672568 / 57833 = 11,63
fecha_estimada  = 2026-07-27 + 11,63 meses ≈ mediados de julio de 2027
```

Con 3 meses cerrados esto se emite como **`provisional`**, con aviso de muestra corta.

**Cifra de contexto obligatoria junto al ritmo oficial:** el "ritmo sin gastos puntuales". Un solo viaje hunde la media y desplaza la fecha meses. La cifra oficial es la media simple; la otra se muestra al lado, etiquetada, nunca sustituyéndola.

## 4. Caso límite: ritmo de ahorro <= 0

No se devuelve fecha. Se devuelve:

```
mensaje: "A este ritmo no alcanzas el objetivo"
ahorro_minimo_necesario = deficit / horizonte_meses
  → 672568 / 24 = 28024 → 280,24 €/mes para lograrlo en 2 años
```

## 5. Caso límite: menos de 2 meses cerrados

`suficiencia = 'insuficiente'`. Se muestra el CSM provisional etiquetado y **cero proyección**. Con los datos reales actuales (registro desde junio de 2026) este es el estado esperado al arrancar: no es un bug.

## 6. Caso límite: objetivo cumplido

`deficit = 0` → modo mantenimiento. Sin divisiones por cero. La pregunta cambia a: "¿sigues cubierto si el CSM sube?".

## 7. El objetivo es móvil (regla crítica)

Sube el alquiler 60,00 €/mes. Nueva base `1.498,50` → CSM `1.723,28` → objetivo `10.339,68`.

```
progreso: 32,2 % → 30,9 %     con el MISMO ahorro de 3.200,00
```

Alerta obligatoria: *"Tu objetivo ha subido 414,00 € este mes. Causa principal: Vivienda - Alquiler / Hipoteca (+60,00 €/mes)."*
Sin este aviso el usuario cree que ha empeorado su disciplina cuando lo que ha cambiado es el suelo.

## 8. Conciliación declarado vs calculado

```
declarado  = 3.200,00
calculado  = Σ ahorro neto desde el inicio del registro = 3.585,00
divergencia = 385,00
umbral      = max(50,00 · 5% de 3.200,00 = 160,00) = 160,00
385,00 > 160,00 → SE SEÑALA
```

Mensaje: posible gasto no registrado por ~385,00 €. **No se sobrescribe ninguna de las dos cifras.** Se muestran ambas con su fecha de última actualización.

## 9. Tasa de ahorro mensual (suelo de disciplina)

```
objetivo_mensual = ingreso_recurrente_del_mes × porcentaje_objetivo   // 0,22 por defecto
2.400,00 × 0,22 = 528,00 €
```

El 22 % es un **suelo**, no un techo. Si el fondo de emergencia exige más que ese suelo, la app lo dice explícitamente. Ritmo actual `578,33` > `528,00` → suelo cumplido.

## 10. Objetivos secundarios

Campos: nombre, importe objetivo, fecha límite opcional.

```
mensual_necesario = importe_objetivo / meses_hasta_fecha_limite
capacidad_libre   = ritmo_ahorro - aporte_necesario_al_fondo
compatible        = mensual_necesario <= capacidad_libre
```

Prioridad no negociable: **el fondo de emergencia primero**. Un objetivo secundario incompatible se muestra como tal, con la cifra que le falta.

## 11. La foto mensual (`objetivo_historico`)

La foto del mes **M** es el objetivo que se mostraba DURANTE M: se calcula con los meses con datos **anteriores a M**, con la misma fórmula de §1 y §2. La escribe una vez, al cierre de M, la tarea `foto-mensual-objetivos`; `GET /objetivos/estado` solo la lee.

Con los datos de §1 (`2026-04` = 1.420,00, `2026-05` = 1.385,50, `2026-06` = 1.510,00) y hoy = `2026-07-27`:

```
foto de 2026-06  (meses < 06: 04 y 05)
  base     = (142000 + 138550) / 2 = 140275
  CSM      = 140275 × 1,15 = 161316,25 → HALF_UP → 161316
  objetivo = 161316 × 6 = 967896                       → 9.678,96 €

cálculo en vivo en julio  (meses 04, 05 y 06)
  objetivo = 165428 × 6 = 992568                       → 9.925,68 €

delta = 992568 − 967896 = 24672                       → "Tu objetivo ha subido 246,72 € este mes"
```

Si la foto de junio se calculara con junio dentro, valdría 992568 igual que el cálculo en vivo, el delta sería siempre 0 y la alerta de §7 nunca saltaría.

Casos límite:

- **Primer mes con datos** (sin ningún mes anterior): no tiene foto. Un 0 sería un dato inventado, y el mes siguiente compararía contra él y avisaría de una subida que no existe.
- **Un mes sin transacciones** entre dos con datos sí tiene foto (el mes siguiente la compara).
- **La API estuvo parada** uno o varios cierres: la primera pasada tras arrancar crea todas las que falten, cada una con su propia ventana.
- **Ya tenía foto** (también las que escribió la versión antigua de `GET /objetivos/estado`): se respeta tal cual, no se recalcula. Los parámetros con los que se calculó (`margen_seguridad`, `meses_objetivo`) quedan en la propia fila.
- **Dos instancias a la vez**: `ON CONFLICT (mes_cobertura) DO NOTHING`; escribe una, la otra no hace nada.
- **El objetivo derivado no cabe en `numeric(12, 2)`**: la foto de ese mes **se omite**, igual que un mes sin datos previos: sin foto no hay alerta de objetivo al alza. El tope de entrada (`MAX_IMPORTE_CENTS` = 999 999 999 999 céntimos) acota cada importe suelto, pero el objetivo multiplica por ≈ 6,9 (`× 1,15 × 6`) una media de sumas mensuales, y el número de transacciones por mes no tiene tope. Con una base mensual de 1.449.275.362,31 € (144 927 536 231 céntimos) el objetivo es 9.999.999.999,96 € y cabe; con 1.449.275.362,32 € ya son 10.000.000.000,02 € y no. Con la ventana por defecto (los 3 meses con datos anteriores a M): si los tres tienen un gasto esencial recurrente de 9.999.999.999,99 € (legal), la base es 9.999.999.999,99 €, `csm` 11.499.999.999,99 € y `objetivo` 68.999.999.999,94 €; si ese gasto está en uno solo de los tres, la base es 3.333.333.333,33 €, `csm` 3.833.333.333,33 € y `objetivo` 22.999.999.999,98 €, y tampoco cabe. Se omite ese mes, **no los siguientes**: un mes cuya ventana ya no contiene la base enorme sale con normalidad. La ventana de M es fija, así que una foto omitida NO se arregla sola con otra ventana: solo cambia si se editan o borran datos. Se reintenta en cada pasada porque es lo más simple y, a esta escala, es aceptable. El mes omitido no deja fila y el `warn` (mes y motivo fijo, jamás un importe) sale una vez por mes y proceso. Qué pasa en `GET /objetivos/estado`: nada, calcula en vivo y no escribe. **Límite aceptado:** unas 9.008 filas del tope en un mismo mes suman más que `Number.MAX_SAFE_INTEGER`: `cents()` lanza `RangeError`, las consultas responden 500 y la tarea falla en cada pasada. Ya ocurría antes y NO se captura como «derivado fuera de rango», porque ocultaría un fallo real.
- **Mes en curso**: nunca se fotografía. "Cerrado" es `mes_cobertura < mes actual` según el `Clock` en `Europe/Madrid`: la foto del mes que acaba sale en la primera pasada tras la medianoche de Madrid, como mucho `FOTO_MENSUAL_OBJETIVOS_INTERVALO_MINUTOS` después.
