# FinApp — guía para agentes

App personal de control y optimización de gastos, de un solo usuario. Repositorio público en GitHub (`carellabs/finapp`, licencia MIT), con CI en GitHub Actions. Despliegue previsto en `finanzas.carellabs.com`, detrás de Cloudflare Access.

## Antes de tocar código: lee el skill que corresponda

Los skills de `.claude/skills/` son la memoria del proyecto. Cada uno declara su contrato de activación; el detalle numérico vive en su carpeta `references/`.

| Vas a tocar…                                                                      | Lee primero                                    |
| --------------------------------------------------------------------------------- | ---------------------------------------------- |
| Totales, agregados, pass-through, `mes_cobertura`, presupuestos, préstamos, deuda | `.claude/skills/finanzas-domain/SKILL.md`      |
| CSM, fondo de emergencia, progreso, proyección, ahorro declarado                  | `.claude/skills/objetivos-ahorro/SKILL.md`     |
| Insights, tendencias, umbrales de suficiencia, simulador                          | `.claude/skills/insights-engine/SKILL.md`      |
| Migraciones, esquema, índices, SQL, conversión de importes                        | `.claude/skills/db-conventions/SKILL.md`       |
| Endpoints, validación Zod, formato de respuesta y errores                         | `.claude/skills/api-conventions/SKILL.md`      |
| Tests, cobertura, property-based, mutation testing                                | `.claude/skills/testing-strategy/SKILL.md`     |
| Auth, sesiones, secretos, dependencias, Docker, despliegue                        | `.claude/skills/security-engineering/SKILL.md` |
| Componentes, vistas, formato `es-ES`, Tailwind, accesibilidad                     | `.claude/skills/frontend-patterns/SKILL.md`    |
| Ramas, commits, PR, issues, CI de GitHub                                          | `.claude/skills/finapp-github/SKILL.md`        |

## Reglas del repositorio

- **Remoto:** `git@github.com:carellabs/finapp.git`. **El push y la fusión de PR los hace Fabrizio**: el agente no hace push ni fusiona. **Commits, solo con permiso explícito.**
- **Flujo:** rama y PR con _squash merge_. Nada de commits directos en `main`; la única excepción fue el commit inicial.
- **Commits convencionales:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. Lo de seguridad va como `fix(security)` o `feat(security)`. Sin atribución a IA ni `Co-Authored-By`.
- **Gates:** `npm run ci` en local (lint, format, typecheck, cobertura, integración, audit, secretos, build) y los mismos checks en GitHub Actions, obligatorios para fusionar. El pre-commit de Husky ejecuta la parte rápida. **Nunca `--no-verify`**: si un hook falla, se arregla la causa.
- **El repositorio es público:** nunca datos reales, dumps, exports ni capturas con cifras propias. Los secretos viven solo en `.env`, que está ignorado.
- **Ninguna fase se cierra en rojo**, ni con vulnerabilidades altas o críticas abiertas.
- **Cada bug se arregla con un test de regresión primero**, y luego el fix.
- **Prohibidos los datos inventados.** Si falta un dato, el sistema falla ruidosamente.

## Estructura

```
shared/   @finapp/shared — dominio puro. Sin BD, sin HTTP, sin React.
api/      Express 5 + Postgres. Hexagonal: http -> usecases -> repositorios.
web/      React 19 + Vite + Tailwind. Container/presentational + atomic design.
docker/   Dockerfiles multi-stage, usuario no-root.
scripts/  ci.mjs y scan-secrets.mjs.
```

`shared` no importa nada de `api` ni de `web`. Si una función de dominio necesita la base de datos, le falta un parámetro.

## Comandos

```bash
npm run ci              # cadena completa de gates
npm test                # tests de los tres workspaces
npm run typecheck       # tsc --noEmit en los tres
npm run test:scripts    # tests de los scripts de gates (necesitan Docker o gitleaks)
npm run build:imagenes  # construye el target production de los dos Dockerfiles y el migrate de la API
npm run test:imagenes   # ejecuta migrate (up/down/up), roles y el alta de usuario (con un pty de verdad); solo necesita Docker
npm run audit:migrate   # audita lo que lleva la imagen migrate (node-pg-migrate es devDependency); solo lee el lockfile
docker compose up       # entorno local (requiere .env, ver env.example)
```

La versión exacta de Node está en `.nvmrc` (CI y Dockerfiles usan la misma).
