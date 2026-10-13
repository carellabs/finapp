# Configuración de GitHub de `carellabs/finapp` (fase 2)

> **Pasos 0 a 5 ejecutados contra el repositorio real el 13-oct-2026**, menos los checks obligatorios del ruleset, que llegan con los workflows (apartado 3.2, pendiente). Lo que se comprobó y lo que no está en "Verificado" y "No verificado", al final. Antes de repetir un paso, comprueba que la documentación enlazada sigue diciendo lo mismo.

Se ejecuta **una sola vez**, por una persona (no por un agente). Los comandos se lanzan desde la raíz del repositorio, en el orden de esta guía. Cada paso trae su comprobación.

## Variables

```bash
OWNER=carellabs                      # cuenta personal de GitHub
REPO="$OWNER/finapp"
```

Las variables solo existen en la terminal donde las defines: ejecuta toda la guía en la misma sesión, o vuelve a definirlas antes de cada bloque. Donde la guía distingue entre organización y cuenta personal, aplica siempre "cuenta personal" (la API devuelve `"type": "User"`).

## 0. Comprobaciones previas

```bash
gh auth status                      # cuenta carellabs, "Git operations protocol: ssh"
ssh -T git@github.com               # "Hi carellabs! ..." (pide la frase de la clave)
git config --local user.email       # identidad propia del repo definida (si sale vacío, para)
git branch --show-current           # main (o la rama de trabajo, ver la skill)
```

**El push va por SSH**, con la clave de la cuenta `carellabs`. `gh` se usa solo para la API (crear el repo, etiquetas, ajustes, ruleset) con los scopes por defecto. El agente no hace push ni fusiona PR: lo hace Fabrizio.

## 1. Crear el repositorio, las etiquetas y hacer el primer push

El orden importa: las etiquetas tienen que existir **antes** de que llegue `dependabot.yml`, porque sus primeros PR (con `labels: ["type:chore"]`) saldrían sin etiqueta. Y para crear etiquetas el repositorio tiene que existir.

### 1.1 Crear el repositorio público (vacío, sin remoto local todavía)

```bash
gh repo create carellabs/finapp --public
```

Sin licencia ni README: la licencia MIT llega en un PR aparte, que sirve de PR de prueba (ver "Primer PR de prueba").

### 1.2 Etiquetas

También las usa el workflow `pr-policy` al etiquetar cada PR y Dependabot. `--force` actualiza la etiqueta si ya existe.

```bash
gh label create "type:feature"         --repo "$REPO" --color 0E8A16 --description "Funcionalidad nueva (feat, perf)" --force
gh label create "type:bug"             --repo "$REPO" --color D73A4A --description "Corrección de un fallo (fix, revert)" --force
gh label create "type:docs"            --repo "$REPO" --color 0075CA --description "Documentación" --force
gh label create "type:refactor"        --repo "$REPO" --color 5319E7 --description "Refactor sin cambio de comportamiento" --force
gh label create "type:chore"           --repo "$REPO" --color CFD3D7 --description "Mantenimiento (chore, style, test, build, ci)" --force
gh label create "type:breaking-change" --repo "$REPO" --color B60205 --description "Cambio incompatible (tipo con !)" --force
```

Comprobación: `gh label list --repo "$REPO" --limit 100 --json name --jq '.[].name' | grep '^type:'` debe listar las seis. No uses `--search "type:"`: es una búsqueda difusa y puede ocultar alguna.

### 1.3 Remoto y primer push

```bash
git remote add origin "git@github.com:$REPO.git"
git push -u origin main
```

Lo hizo Fabrizio: el commit inicial `9855054` (`feat: primera versión de FinApp`). Ese `git push` directo a `main` es la **única excepción** a la regla "nunca push a `main`": el repositorio estaba vacío y todavía no había ruleset. Desde el apartado 3, `main` está protegida.

Comprobación del remoto: `git remote get-url origin` debe dar `git@github.com:carellabs/finapp.git` (SSH, no `https://`). Y `gh repo view "$REPO" --json visibility,defaultBranchRef --jq '.visibility, .defaultBranchRef.name'` debe dar `PUBLIC` y `main`.

## 2. Ajustes del repositorio

Solo squash, con el título del PR como título del commit y los mensajes de los commits de la rama como mensaje; ramas fusionadas se borran; sin wiki.

```bash
gh api -X PATCH "repos/$REPO" \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -f squash_merge_commit_title=PR_TITLE \
  -f squash_merge_commit_message=COMMIT_MESSAGES \
  -F delete_branch_on_merge=true \
  -F allow_update_branch=true \
  -F has_wiki=false
```

`-F` (mayúscula) envía booleanos reales; `-f` los enviaría como texto `"false"`. No los intercambies.

Comprobación:

```bash
gh api "repos/$REPO" --jq '{allow_squash_merge, allow_merge_commit, allow_rebase_merge, squash_merge_commit_title, squash_merge_commit_message, delete_branch_on_merge, allow_update_branch, has_wiki}'
```

Esperado: `{"allow_squash_merge":true,"allow_merge_commit":false,"allow_rebase_merge":false,"squash_merge_commit_title":"PR_TITLE","squash_merge_commit_message":"COMMIT_MESSAGES","delete_branch_on_merge":true,"allow_update_branch":true,"has_wiki":false}`.

`allow_update_branch`: el ruleset exige que la rama del PR esté al día con `main` (`strict_required_status_checks_policy`); con este ajuste el PR muestra el botón *Update branch* en vez de obligar a actualizarla a mano.

Por qué `COMMIT_MESSAGES`: el cuerpo del commit en `main` es la lista de los commits convencionales de la rama, uno por unidad de trabajo, en lugar de la plantilla del PR con sus casillas y comentarios. Con `PR_BODY` esa plantilla entera acabaría en el historial.

## 3. Ruleset de la rama por defecto

El fichero `assets/ruleset-main.json` (en esta misma skill) define, sobre `~DEFAULT_BRANCH`:

| Regla | Efecto |
|---|---|
| `deletion` | `main` no se puede borrar |
| `non_fast_forward` | sin force push |
| `required_linear_history` | historial lineal |
| `pull_request` | PR obligatorio, 0 aprobaciones, hilos resueltos, solo squash |
| `required_status_checks` | `test`, `integracion`, `seguridad`, `imagenes` y `pr-policy`, publicados por la app GitHub Actions (`integration_id` 15368), con política estricta (la rama del PR debe estar al día con `main`) |

`bypass_actors` está vacío: nadie, tampoco el propietario, se salta el ruleset. Para una emergencia, desactívalo a mano en *Settings > Rules > Rulesets*.

El `integration_id` evita que otra app o un estado publicado a mano por la API satisfaga un check con el mismo nombre. 15368 es el identificador de la app GitHub Actions: se confirma con `gh api apps/github-actions --jq .id`.

### 3.1 Creación inicial (hecha el 13-oct-2026, sin checks)

Se creó el ruleset **24988801** con las cuatro primeras reglas y sin `required_status_checks`, porque los workflows todavía no existían: un check obligatorio que ningún workflow publica deja todos los PR en "Expected - Waiting for status to be reported".

```bash
gh api -X POST "repos/$REPO/rulesets" --input <ruleset-sin-checks.json>
gh api "repos/$REPO/rulesets" --jq '.[] | {id, name, enforcement}'
gh api "repos/$REPO/rules/branches/main" --jq '.[].type'
```

Resultado: un ruleset `main`, `enforcement: "active"`, con `deletion`, `non_fast_forward`, `required_linear_history` y `pull_request`.

### 3.2 Añadir los checks obligatorios (PENDIENTE)

**Lo ejecuta la sesión principal (o Fabrizio), no el agente que escribe los workflows.** Los cinco nombres son los `name` de los jobs: `test`, `integracion`, `seguridad` e `imagenes` (de `ci.yml`) y `pr-policy` (de `pr-policy.yml`). El job `label` (pone la etiqueta `type:*`), `audit.yml` (auditoría semanal completa) y `codeql.yml` no son obligatorios.

Orden recomendado, para no bloquear el PR de esta fase con un nombre mal puesto:

1. Abre el PR de esta fase. Sus workflows corren sobre el propio PR.
2. Comprueba que aparecen **los cinco checks con esos nombres exactos** (y `label`, `analyze` aparte).
3. Entonces actualiza el ruleset:

```bash
gh api -X PUT repos/carellabs/finapp/rulesets/24988801 --input .claude/skills/finapp-github/assets/ruleset-main.json
```

4. Comprueba:

```bash
gh api "repos/$REPO/rulesets/24988801" --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[] | "\(.context) \(.integration_id)"'
```

Esperado: las cinco líneas `test`, `integracion`, `seguridad`, `imagenes` y `pr-policy`, todas con `15368`.

5. Fusiona el PR con squash.

Si un check se queda en "Expected - Waiting for status to be reported", el contexto no coincide con el nombre real del job: corrígelo en `assets/ruleset-main.json` y repite el `PUT`. Para deshacerlo: `gh api -X DELETE "repos/$REPO/rulesets/24988801"`.

Referencia de los campos: [REST, reglas y rulesets](https://docs.github.com/en/rest/repos/rules).

Un test (`.github/scripts/repo-config.test.mjs`) vigila que los contextos del JSON sean exactamente los `name` de los jobs obligatorios, que cada paso de `scripts/ci.mjs` corra en `ci.yml`, y que no cambie nada del resto de la protección.

## 4. Seguridad del repositorio y de Actions

### 4.1 Alertas, actualizaciones de seguridad y escaneo de secretos

```bash
gh api -X PUT "repos/$REPO/vulnerability-alerts"
gh api -X PUT "repos/$REPO/automated-security-fixes"
gh api -X PUT "repos/$REPO/private-vulnerability-reporting"   # canal privado que cita SECURITY.md (Report a vulnerability)

gh api -X PATCH "repos/$REPO" --input - <<'EOF'
{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" }
  }
}
EOF
```

Se activan primero las alertas (que habilitan el grafo de dependencias) y después las actualizaciones de seguridad automáticas, porque estas últimas se apoyan en ese grafo.

Comprobación:

```bash
gh api "repos/$REPO/vulnerability-alerts" -i | head -n 1     # 204 = activadas, 404 = desactivadas
gh api "repos/$REPO/automated-security-fixes" --jq .enabled   # true
gh api "repos/$REPO/private-vulnerability-reporting" --jq .enabled   # true
gh api "repos/$REPO" --jq .security_and_analysis              # secret_scanning y push protection: enabled
```

### 4.2 Actions: acciones fijadas por SHA, aprobación de forks y token de solo lectura

```bash
# Exige que toda acción de un workflow esté fijada a un SHA completo (los nuestros ya lo están).
gh api -X PUT "repos/$REPO/actions/permissions" -F enabled=true -F sha_pinning_required=true

# Los PR de colaboradores externos (forks) necesitan aprobación manual para ejecutar workflows.
gh api -X PUT "repos/$REPO/actions/permissions/fork-pr-contributor-approval" \
  -f approval_policy=all_external_contributors

# El token de los workflows es de solo lectura por defecto y no puede aprobar PR.
gh api -X PUT "repos/$REPO/actions/permissions/workflow" \
  -f default_workflow_permissions=read \
  -F can_approve_pull_request_reviews=false
```

Comprobación:

```bash
gh api "repos/$REPO/actions/permissions" --jq '{enabled, sha_pinning_required}'                 # true, true
gh api "repos/$REPO/actions/permissions/fork-pr-contributor-approval" --jq .approval_policy      # all_external_contributors
gh api "repos/$REPO/actions/permissions/workflow"                                                 # read, false
```

Todas las acciones de `.github/workflows/` están fijadas por SHA de 40 caracteres con la versión en un comentario; un test lo vigila. Los SHA de `actions/checkout`, `actions/setup-node` y `github/codeql-action` se resolvieron con `gh api repos/<owner>/<accion>/git/ref/tags/<tag>` (y, para el tag anotado de `codeql-action`, con `git/tags/<sha>` hasta el commit).

### 4.3 CodeQL: como workflow, con la «default setup» desactivada

CodeQL va como **workflow** (*configuración avanzada*), no con la «default setup» de GitHub. `.github/workflows/codeql.yml` analiza `actions` (los propios workflows) y `javascript-typescript` (api, web, shared, scripts y configuración), sin compilar (`build-mode: none`), en cada PR (sin filtro de ramas, para que los PR encadenados también se analicen), en cada push a `main` y cada miércoles. Sus permisos son los mínimos: `contents: read` en el workflow y `security-events: write` solo en su job.

**No es un check obligatorio.** Es un análisis informativo: sus resultados se ven en *Security > Code scanning*.

La «default setup» tiene que quedar **desactivada**. Si se activa, GitHub rechaza los resultados que sube el workflow y el análisis falla al enviarlos ([REST de code scanning](https://docs.github.com/en/rest/code-scanning/code-scanning)):

```bash
gh api "repos/$REPO/code-scanning/default-setup" --jq .state                       # not-configured
gh api -X PATCH "repos/$REPO/code-scanning/default-setup" -f state=not-configured   # solo si salió "configured"
```

Tras la primera ejecución del workflow, deben aparecer las dos categorías:

```bash
gh api "repos/$REPO/code-scanning/analyses" --jq '.[].category' | sort -u    # /language:actions y /language:javascript-typescript
```

**Lo que ve un PR no es todo.** En un PR, CodeQL solo informa de lo que introduce ese PR. Las alertas de código que el PR no toca salen en el análisis completo de `main` (y en el semanal). Para ver las abiertas:

```bash
gh api "repos/$REPO/code-scanning/alerts?state=open" --jq '.[] | "#\(.number) \(.rule.id) \(.most_recent_instance.location.path):\(.most_recent_instance.location.start_line)"'
```

## 5. Autenticación en dos factores

`carellabs` es una cuenta personal: no existe el ajuste de organización. Se activa 2FA en la propia cuenta (*Settings > Password and authentication*); además GitHub exige 2FA a quien contribuye código en github.com. Ya estaba activo.

## Primer PR de prueba

El PR que añada la licencia MIT (aparte de esta fase) es el primero que pasa por todo el circuito. Comprueba:

- que aparecen los checks `test`, `integracion`, `seguridad`, `imagenes` y `pr-policy` con esos nombres exactos (y que `label` aparece aparte, sin ser obligatorio);
- que el PR recibe la etiqueta `type:docs` (o la que corresponda a su título);
- que el botón de fusión solo ofrece *Squash and merge*, que el título propuesto es el del PR y que el mensaje son los commits de la rama;
- que un PR `feat: ...` sin `Closes #N` falla en `pr-policy` **y aun así recibe la etiqueta `type:feature`** (es la comprobación del paso de salidas entre los jobs `pr-policy` y `label`).

## Qué escanea `scan:secrets` en CI

En el job `seguridad` no hay nada «preparado» (`git add`): el checkout deja el índice igual que `HEAD`. El primer paso de `scripts/scan-secrets.mjs` (`gitleaks git --staged`) escanea el índice y no encuentra nada que escanear: pasa en vacío. El que trabaja es el segundo paso, el **histórico completo** (todos los commits alcanzables de todas las referencias que trae el checkout), y por eso el job usa `fetch-depth: 0`. Con un clon superficial solo vería el último commit.

Comprobado el 13-oct-2026 con clones locales (sin tocar el repositorio): un commit mete un secreto de prueba y el siguiente lo borra. En un clon completo, el paso de «preparados» informa `0 commits scanned` y el del histórico encuentra el secreto (`leaks found: 1`, salida 1). En un clon con `--depth 1`, el valor por defecto de `actions/checkout`, el mismo secreto pasa sin verse (`1 commits scanned`, salida 0).

## Verificado

Comprobado el 13-oct-2026 con `gh api` de solo lectura sobre el repositorio real, y con los scripts y tests locales:

- **Repositorio**: público, rama por defecto `main`, descripción puesta, sin licencia ni README. `main` contiene el commit inicial `9855054` (`feat: primera versión de FinApp`).
- **Etiquetas**: las seis `type:*`, con los colores y descripciones de 1.2.
- **Ajustes (paso 2)**: `allow_squash_merge` verdadero, `allow_merge_commit` y `allow_rebase_merge` falsos, `squash_merge_commit_title` `PR_TITLE`, `squash_merge_commit_message` `COMMIT_MESSAGES`, `delete_branch_on_merge` y `allow_update_branch` verdaderos, `has_wiki` falso.
- **Ruleset 24988801**: `main`, `active`, sin `bypass_actors`, con `deletion`, `non_fast_forward`, `required_linear_history` y `pull_request` (0 aprobaciones, hilos resueltos, solo squash), y **sin** `required_status_checks` hasta el apartado 3.2.
- **Seguridad (4.1)**: las alertas de Dependabot devuelven 204, las actualizaciones de seguridad automáticas y el reporte privado están activados (`true`), y `secret_scanning` y `secret_scanning_push_protection` están en `enabled`. `secret_scanning_non_provider_patterns` y `secret_scanning_validity_checks` siguen desactivados: son extras que este repositorio no usa.
- **Actions (4.2)**: `sha_pinning_required` verdadero, política de aprobación de forks `all_external_contributors`, token de workflows `read` con `can_approve_pull_request_reviews` falso.
- **CodeQL (4.3)**: la «default setup» devuelve `not-configured`, como debe estar para que el workflow pueda subir sus resultados.
- **`integration_id`**: `gh api apps/github-actions --jq .id` devuelve 15368.
- **Remoto**: `origin` es `git@github.com:carellabs/finapp.git` (SSH).
- **Acciones**: los tres SHA (`actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, `github/codeql-action` v4.38.3) se resolvieron contra la API y coinciden con los que usa `carellabs-landing`.
- **Workflows y scripts, en local**: los tests de `.github/scripts/` (política de PR y guardas de configuración) y `npm run ci` en verde.
- **Sintaxis de los workflows**: `actionlint` 1.7.12 (imagen `rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667`) da 0 errores en los cuatro; con un workflow roto a propósito detecta los fallos.
- **`dependabot.yml`**: válido contra el esquema de SchemaStore (`dependabot-2.0.json`); el mismo validador rechaza una clave inventada y un intervalo no válido.
- **`npm audit` sin `npm ci`**: en un clon limpio, sin `node_modules`, audita las 612 dependencias del lockfile y termina sin vulnerabilidades altas ni críticas, con y sin `--omit=dev`. Es lo que hace el job `seguridad`.

## No verificado

Lo que queda de verdad pendiente:

- **Los cinco checks en un runner real**: ningún workflow se ha ejecutado todavía en GitHub. En particular `integracion` (Postgres efímero con Docker en el puerto 55433), `seguridad` (gitleaks vía Docker contra un checkout propiedad de otro usuario, con `safe.directory` por entorno; y `npm audit` sin `npm ci`, leyendo solo el lockfile), `imagenes` (los dos `docker build` del target `production`) y `test` (que incluye los tests del gate de secretos, que usan Docker). Los tiempos máximos (`timeout-minutes`) son estimaciones.
- **Los nombres de los checks en el ruleset**: se confirman cuando aparezcan en el primer PR (apartado 3.2). Hasta entonces, el ruleset real no los exige.
- **Dependabot**: que acepta `exclude-patterns` en el grupo de `docker`, que lee `api.Dockerfile` y `web.Dockerfile` (no se llaman `Dockerfile`) y que los títulos de sus PR caben en los 100 caracteres de la política. El test fija el peor caso que se puede calcular, no el título real.
- **Salida de etiqueta entre jobs cuando `pr-policy` falla**: el código del runner evalúa las `outputs` del job al terminar, falle o no un paso, y la documentación solo dice que se evalúan "al final de cada job". Que el job `label` las reciba con el job anterior en rojo se confirma con el PR `feat:` sin issue del apartado "Primer PR de prueba". Si no llegara, el efecto sería solo que ese PR no se etiqueta.
- **CodeQL con PR de Dependabot y de forks**: falta ver cómo se comporta (su token es de solo lectura, así que subir resultados puede no estar permitido; al no ser obligatorio, no bloquea la fusión).
- **Los workflows programados** (`audit.yml`, `codeql.yml`): GitHub desactiva los de un repositorio público tras 60 días sin actividad; si deja de llegar el aviso, actívalos de nuevo desde la pestaña *Actions*.
- **2FA**: lo declara el propietario; la API no lo expone para una cuenta personal.
