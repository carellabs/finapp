# Controles de seguridad

## Autenticación — implementación real (Fase 6)

- **Hashing:** `@node-rs/argon2`, sin opciones explícitas (Argon2id ya es el default de la librería). El enum `Algorithm` es un *const enum* ambiental incompatible con `verbatimModuleSyntax`: no se importa, se confía en el default.
- **Sesión:** cookie `sid`, valor = token aleatorio de 32 bytes (`crypto.randomBytes`, base64url). La BD (`sesiones.token_hash`) guarda **SHA-256 del token**, no Argon2id: Argon2id es para secretos adivinables por humanos (contraseñas); un token de 256 bits de entropía no lo es, y aquí lo que hace falta es una búsqueda por igualdad rápida.
- **Duración de sesión:** 30 días (`api/src/auth/sesiones.ts`). Personal, un solo usuario: se prioriza no reautenticar constantemente.
- **Lectura de la cookie `sid`:** un único helper, `leerTokenSesion` (`api/src/auth/cookie-sesion.ts`), que usan el middleware de sesión, el login y el logout. Devuelve el valor solo si es un texto no vacío: `cookie-parser` convierte en JSON las cookies que empiezan por `j:` (`sid=j:123` llega como número, `sid=j:{"a":1}` como objeto) y hashear eso lanzaba un `TypeError` (500). Una cookie que no es texto equivale a no tener cookie.
- **Rotación en el login:** si la petición trae una cookie `sid`, esa sesión se revoca antes de crear la nueva, **solo si es del usuario que inicia sesión** (un login como A no da poder sobre las sesiones de B) y **solo tras autenticar** (un intento fallido no revoca nada). La respuesta es la misma con o sin cookie previa, con una propia o ajena: no hay un oráculo para saber si un token existe.
- **Límite de sesiones activas por usuario:** `MAX_SESIONES_POR_USUARIO` (1 a 50, por defecto 5, validado con Zod en `cargarEnv`). Al crear una sesión se borran las más antiguas hasta quedar en N. `crearSesion` es **una transacción** (`enTransaccion`, ver abajo) que bloquea la fila del usuario (`FOR NO KEY UPDATE`): sin el bloqueo, dos logins simultáneos no verían la inserción del otro (READ COMMITTED) y dejarían más de N; una sola sentencia con CTE tampoco basta, comparte instantánea. La sesión recién creada se excluye de la poda por id (si el reloj retrocediera, ordenar por fecha podría borrar la cookie recién entregada) y `created_at` usa `clock_timestamp()` (`now()` es el inicio de la transacción, no el orden de inserción).
- **Purga de sesiones caducadas:** `iniciarPurgaSesiones` (`api/src/auth/purga-sesiones.ts`) sobre `iniciarTareaPeriodica` (`api/src/infra/tarea-periodica.ts`: una vez al arrancar y después cada intervalo, `unref()`, sin solapes, errores al log sin mensaje ni datos, `detener()` para el apagado). Intervalo `PURGA_SESIONES_INTERVALO_MINUTOS` (1 a 1440, por defecto 60). Se arranca desde `arrancar()` (`api/src/servidor.ts`, que `main.ts` solo envuelve), nunca desde `crearApp`. Registra cuántas borra, sin ids ni tokens. Si el registro falla (`registrar` lanza), la tarea sigue: un log roto no puede tumbarla. Una sesión caducada ya no autentica (`verificarSesion` mira `expira_en`): la purga es higiene de la tabla.
- **Transacciones (`enTransaccion`, `api/src/db/transaccion.ts`):** el único sitio que presta una conexión para transaccionar (límite de sesiones, write-off de préstamos).
  - **Aislamiento fijado** a READ COMMITTED aunque la base de datos tenga otro por defecto: con REPEATABLE READ la instantánea se toma en la primera sentencia, antes de esperar el bloqueo, y el límite se superaría sin error alguno.
  - **`lock_timeout` de 5 s** (`LOCK_TIMEOUT_MS`), local a la transacción (`set_config(..., true)`, parametrizado), y además en cada conexión de `crearPool` como parámetro de arranque: así lo acotan también las sentencias que no pasan por el helper (el `UPDATE` de intentos fallidos del login, que se queda esperando la misma fila). Justificación: estas transacciones retienen sus bloqueos milisegundos; 5 s es una transacción atascada, y cada petición que espera ocupa una de las 10 conexiones del pool (que se rinde a los 5 s): sin tope, las esperas detienen toda la API. `55P03` se traduce a **409 `CONFLICTO`** (conflicto con una operación concurrente que el cliente resuelve reintentando).
  - **Escucha `error` en el cliente** mientras lo tiene prestado (el pool no escucha los clientes prestados: si matan la conexión a media transacción, sería una excepción no capturada) y lo quita al soltarlo. Si el ROLLBACK también falla, **`release(true)`** destruye la conexión y se conserva el error original.
- **Errores del pool:** `crearPool` escucha `error` (clientes ociosos cortados por un reinicio de Postgres) y lo registra con tipo y código, sin mensaje ni URL. Sin escuchador, un reinicio de la base de datos mataba la API.
- **Apagado ordenado (`arrancar().apagar()`):** deja de aceptar peticiones, detiene las tareas periódicas (espera a la que esté en curso) **y después** cierra el pool. Es idempotente y tiene un plazo máximo (`PLAZO_APAGADO_MS`, 8 s, menor que los 10 s de `docker stop`): si algo se cuelga, lo registra y cierra igualmente. Nunca rechaza.
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
8. **Sesión revocada tras logout** → el token anterior devuelve `401`. Igual la sesión rotada en un nuevo login y la podada por el límite (`api/tests/integration/sesiones.test.ts`).
9. **Bloqueo temporal tras N intentos de login fallidos**, y el bloqueo **sobrevive a un reinicio** del proceso.

## Superficie de ataque — configuración

- Helmet con CSP restrictiva, sin `unsafe-inline`.
- CORS: origen exacto del frontend, credenciales permitidas solo para ese origen.
- CSRF: `SameSite=Strict` más una segunda barrera, `verificarOrigen` (`api/src/http/origen.ts`). En `/api/v1`, los métodos que no son `GET`, `HEAD` ni `OPTIONS` exigen `Origin` igual a `ORIGEN_FRONTEND` o, sin `Origin`, `Sec-Fetch-Site: same-origin`; lo demás es `403`. Va justo después de `cors` y antes de leer el cuerpo, de los limitadores y de las rutas (incluido el login). `GET`, `HEAD` y `OPTIONS` no se comprueban por ser métodos seguros por contrato; hay una excepción conocida, `GET /api/v1/objetivos/estado`, que escribe (ver `contrato-http.md`). Un rechazo se registra en nivel `warn` con método, ruta sin consulta y booleanos, nunca con los valores de las cabeceras. En producción `ORIGEN_FRONTEND` debe ser `https`. `SameSite` delimita el *sitio*, no el origen: un subdominio hermano de `carellabs.com` es "mismo sitio"; `Origin` sí lo distingue. Sin tokens: `csurf` está abandonado y el doble envío de cookie no aporta nada con un solo origen. `ORIGEN_FRONTEND` se valida en el arranque como origen exacto (`esquema://host[:puerto]`, sin barra final ni ruta). Fuentes: OWASP CSRF Prevention Cheat Sheet, Fetch Standard §3.2 y Fetch Metadata (W3C) §2.3.
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
