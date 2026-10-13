## Issue

<!-- Obligatoria en `feat` y `fix`: sustituye la línea de abajo por "Closes #N" con el número real de la issue.
     En el resto de tipos (docs, chore, refactor, ci...) puedes dejarla tal cual o borrarla.
     Lo que va dentro de un comentario HTML (como este) no cuenta como referencia. -->

Closes #

## Qué cambia y por qué

<!-- El título del PR es el commit convencional que quedará en `main` (se fusiona con squash):
     tipo(scope): descripción, de 100 caracteres como máximo. Ejemplo: feat(web): añade el panel de presupuestos -->

## Verificación

- [ ] `npm run ci` en verde (lint, format, typecheck, cobertura, integración, audit, secretos, tests de scripts, build e imágenes)

## Checklist

- [ ] Nada de datos reales, dumps ni capturas con cifras propias: el repositorio es público
- [ ] He leído la skill que corresponde de la tabla de `AGENTS.md`
- [ ] Si es un bug: el test de regresión está escrito primero y falla sin el arreglo
- [ ] Si toca la base de datos: migraciones up/down/up comprobadas (`npm run test:integration`)
- [ ] Commits convencionales y sin atribución de IA
