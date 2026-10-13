---
name: finapp-github
description: "Trigger: rama, commit, PR, issue, push, merge, GitHub, CI de GitHub en FinApp. Aplica el flujo de ramas, commits, PR e issues del repo."
license: "MIT"
metadata:
  author: carellabs
  version: "1.0"
---

## Activation Contract

Carga esta skill antes de crear ramas, commits, PR o issues, o de tocar `.github/`, en `carellabs/finapp` (repo público).

## Hard Rules

- El agente no hace push ni fusiona: lo hace Fabrizio. Commits solo con permiso explícito, uno por unidad de trabajo, sin atribución de IA ni `Co-Authored-By`.
- Nunca commit directo a `main`. Ramas `tipo/descripcion`: `^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)/[a-z0-9._-]+$`, desde `main` actualizada.
- Commits convencionales `tipo(scope)!: descripción`; seguridad como `fix(security)` o `feat(security)`.
- Fusión por squash. Título del PR = commit final, máximo 100 caracteres. `feat` y `fix` exigen issue y `Closes #N` en el cuerpo.
- Antes de abrir el PR, `npm run ci` en verde. Nunca `--no-verify`, force push ni saltarse checks.
- Repo público: nada de datos reales, dumps ni capturas con cifras propias, en código, issues, PR ni logs.
- Un bug se arregla con su test de regresión primero. Un cambio de BD, con migraciones up/down/up.

## Decision Gates

| Cambio | Commit | ¿Issue? | Etiqueta |
|---|---|---|---|
| Funcionalidad | `feat` | sí | `type:feature` |
| Corrección | `fix` | sí | `type:bug` |
| Documentación | `docs` | no | `type:docs` |
| Refactor | `refactor` | no | `type:refactor` |
| Rendimiento | `perf` | no | `type:feature` |
| Estilo, tests, build, CI, mantenimiento | `style` `test` `build` `ci` `chore` | no | `type:chore` |
| Revertir | `revert` | no | `type:bug` |
| Cualquiera con `!` | `tipo!` | según tipo | `type:breaking-change` |

- Checks obligatorios de `main`: `test`, `integracion`, `seguridad`, `imagenes`, `pr-policy`. CodeQL, la auditoría semanal y `label` no lo son.
- Si un check falla, se arregla la causa. Renombrar un job o añadir un check exige actualizar `assets/ruleset-main.json`; un test lo vigila.

## Execution Steps

1. `git switch main && git pull --ff-only && git switch -c <tipo>/<nombre>`.
2. Lee la skill del área (tabla de `AGENTS.md`); test primero.
3. `npm run ci`; Fabrizio hace el push y abre el PR con la plantilla.
4. Con los cinco checks en verde, Fabrizio fusiona.

## Output Contract

Rama, commits propuestos, resultado de `npm run ci`, título y cuerpo del PR, pendientes.

## References

- `references/github-setup.md`, `assets/ruleset-main.json`: configuración de GitHub y ruleset de `main`.
- `../../../.github/PULL_REQUEST_TEMPLATE.md`, `../../../.github/ISSUE_TEMPLATE/`, `../../../.github/scripts/pr-policy.mjs`: plantillas y política de PR.
