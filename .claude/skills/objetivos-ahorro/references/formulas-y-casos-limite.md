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
