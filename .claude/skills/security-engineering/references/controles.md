# Controles de seguridad

## Autenticación — implementación real (Fase 6)

- **Hashing:** `@node-rs/argon2`, sin opciones explícitas (Argon2id ya es el default de la librería). El enum `Algorithm` es un *const enum* ambiental incompatible con `verbatimModuleSyntax`: no se importa, se confía en el default.
- **Sesión:** cookie `sid`, valor = token aleatorio de 32 bytes (`crypto.randomBytes`, base64url). La BD (`sesiones.token_hash`) guarda **SHA-256 del token**, no Argon2id: Argon2id es para secretos adivinables por humanos (contraseñas); un token de 256 bits de entropía no lo es, y aquí lo que hace falta es una búsqueda por igualdad rápida.
- **Duración de sesión:** 30 días (`api/src/auth/sesiones.ts`). Personal, un solo usuario: se prioriza no reautenticar constantemente.
- **Bloqueo por cuenta** (`api/src/auth/bloqueo.ts`): 5 intentos fallidos → bloqueo de 15 minutos, persistido en `usuarios.intentos_fallidos` / `bloqueado_hasta`. Sobrevive a un reinicio del proceso.
- **Rate limit por IP** (`express-rate-limit`, en `api/src/app.ts`): 10 peticiones / 15 min en `/auth/login`, 120/min en el resto de `/api/v1`. **Instanciado dentro de `crearApp()`, nunca a nivel de módulo** — un limitador a nivel de módulo sería un contador compartido entre cualquier app creada en el mismo proceso (se descubrió como bug real: rompía el aislamiento entre tests).
- **Enumeración de usuarios:** login devuelve el mismo `401` genérico para "usuario inexistente", "cuenta bloqueada" y "contraseña incorrecta" — nunca se distingue el motivo en la respuesta.
- **Cookies:** `httpOnly` + `sameSite=strict` siempre; `secure` solo si `NODE_ENV=production` (en local, sobre HTTP plano, `secure:true` bloquearía el envío de la cookie en el navegador).

## Tests de seguridad como código

Una checklist revisada a mano se degrada en dos semanas. Estos son tests automatizados en `api/tests/security`:

1. **Sin sesión → `401`, nunca datos.** Uno por cada endpoint protegido, generado sobre la tabla de rutas.
2. **Inyección SQL:** payload de inyección en **cada campo de texto** (`descripcion`, `persona`, `concepto`, `nota`) → ni altera la BD ni provoca un `500`.
3. **Body sobredimensionado → `413`.**
4. **JSON anidado abusivo** (profundidad > límite) → rechazado sin agotar CPU.
5. **Rate limiter dispara tras N peticiones** → `429` con `Retry-After`.
6. **La cookie de sesión lleva los tres flags** `httpOnly`, `secure`, `sameSite=strict`.
7. **Las respuestas de error no contienen** rutas de fichero, versiones, nombres de tabla ni stack traces. Test que hace grep sobre el cuerpo de todos los errores posibles.
8. **Sesión revocada tras logout** → el token anterior devuelve `401`.
9. **Bloqueo temporal tras N intentos de login fallidos**, y el bloqueo **sobrevive a un reinicio** del proceso.

## Superficie de ataque — configuración

- Helmet con CSP restrictiva, sin `unsafe-inline`.
- CORS: origen exacto del frontend, credenciales permitidas solo para ese origen.
- Rate limit global en la API, además del específico de login.
- `express.json({ limit: '100kb' })`.
- Pino con `redact` sobre `monto`, `monto_cents`, `descripcion`, `persona`, `nota`, `saldo`, cookies y cabeceras de autorización.

## Cadena de suministro

- Lockfile commiteado; dependencias fijadas.
- `npm audit --audit-level=high` en CI: **bloquea**.
- gitleaks en pre-commit (husky + lint-staged) y en CI con `fetch-depth: 0`.
- Imágenes Docker multi-stage: base mínima, **usuario no-root**, sin herramientas de compilación en la imagen final.
- Toda dependencia nueva se justifica en el mensaje del commit.

## Producción — VPS propio

Decisión tomada: **VPS propio con Docker Compose y Caddy** como reverse proxy.

| Control | Implementación |
|---|---|
| HTTPS + HSTS | Caddy gestiona el certificado y la renovación automáticamente; HSTS activado |
| Postgres | **nunca expuesto a internet**: sin `ports:` publicados, solo red interna de Compose |
| Usuario de BD | permisos mínimos: sin `SUPERUSER`, sin DDL en runtime (las migraciones corren con otro usuario) |
| Backups | `pg_dump` programado, **cifrado con GPG**, replicado a almacenamiento externo |
| Restauración | job de CI **semanal** que restaura el último dump en una BD desechable y verifica el conteo de filas y los totales por mes. Si falla, alerta |
| Logging | Pino estructurado, con redacción, rotado |
| Healthcheck | `/health` sin versiones, sin rutas, sin estado de dependencias |
| Cabeceras | verificadas **en el despliegue real**, no solo en local |
| Firewall | solo 80/443 abiertos; SSH con clave, sin contraseña |

## Auditorías (fases 4, 5, 7 y 9)

1. §8 completo, `npm audit`, gitleaks sobre **todo el historial de git**, revisión manual de la superficie nueva.
2. Calidad: complejidad ciclomática, duplicación, `depcheck`, `any` sin justificar.
3. Correctitud financiera: caso end-to-end con datos reales verificados a mano contra el Excel.
4. Correctitud analítica: cada insight y cada cifra de objetivo revisados uno a uno. **Lo que no se sostenga con su evidencia se elimina.** Un insight erróneo es peor que no tenerlo.
5. Rendimiento: `EXPLAIN ANALYZE` del dashboard, los insights y el CSM con 2.000 transacciones sembradas.

Hallazgos priorizados Crítico / Alto / Medio / Bajo. Críticos y altos se arreglan antes de avanzar.
