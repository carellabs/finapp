---
name: security-engineering
description: "Trigger: auth, login, sesión, cookies, Zod, SQL, secretos, helmet, CORS, rate limit, backups, despliegue, VPS. Seguridad de FinApp; leer antes de tocar auth, entrada de usuario o infraestructura."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract

Leer ANTES de tocar autenticación, sesiones, validación de entrada, SQL, manejo de errores, dependencias, Docker, CI o despliegue. También **antes de cerrar cualquier fase**.

Modelo de amenazas: la app contiene el detalle completo de las finanzas personales de una persona. Las amenazas son **acceso no autorizado y fuga de datos**.

## Hard Rules

1. **Autenticación obligatoria desde el primer despliegue**, aunque el usuario sea uno solo. Nunca "ya lo pondré luego": aplazarla obliga a rehacer sesiones, rutas y validación.
2. **Contraseñas con Argon2id** (`@node-rs/argon2`, binarios precompilados → sin toolchain en la imagen final). Jamás en claro, jamás con hash rápido tipo SHA.
3. **Sesión en cookie `httpOnly` + `secure` + `sameSite=strict`**, con token **hasheado** en la tabla `sesiones`. Revocable al instante.
4. **Cero credenciales, claves o usuarios hardcodeados**, ni siquiera en tests. El usuario se crea con un script CLI que pide la contraseña de forma interactiva.
5. **Zod en el borde de toda entrada.** Lo que no valida, no entra.
6. **SQL siempre parametrizado.** Cero concatenación, sin excepciones.
7. **Sin stack traces, rutas, versiones ni nombres de tabla en las respuestas.** Detalle al log, `codigo` + `request_id` al cliente.
8. **Logs sin importes, sin descripciones y sin datos personales.** Los logs son un vector de fuga: un único punto de salida (`registrarEnConsola`) que redacta por nombre de clave cookies, autorización, contraseñas e importes, y un `request_id` por petición para correlar (ver `references/controles.md`, «Logs»).
9. **`npm audit`: vulnerabilidades altas o críticas bloquean el build.** Escaneo de secretos (gitleaks) en pre-commit y en CI **sobre el histórico completo** (`fetch-depth: 0`).
10. **Un backup no restaurado no es un backup.** La restauración se prueba automáticamente, no se supone.

## Decision Gates

| Necesidad | Decisión |
|---|---|
| sesión | cookie + tabla en Postgres. **No JWT**: revocar exige una lista en BD, así que acabas con la BD igual y más piezas |
| rate limit de login | **dos capas.** El **bloqueo por cuenta** (5 intentos → 15 minutos) va **persistido en Postgres** (`usuarios.intentos_fallidos` / `bloqueado_hasta`): reiniciar el contenedor no lo borra, y es lo que frena la fuerza bruta. El **límite por IP** (`express-rate-limit`) va **en memoria**: con una sola instancia basta, y reiniciar solo reinicia ese contador. Si algún día hay varias instancias, el límite por IP necesitará un almacén compartido |
| CORS / CSP | origen exacto del frontend, **nunca `*`**; CSP de las páginas sin `unsafe-inline` ni `unsafe-eval` (la fija el Caddy interno, `docker/Caddyfile`; detalle en `references/controles.md`) |
| render de texto del usuario | escapado por defecto de React. **Prohibido `dangerouslySetInnerHTML`** |
| nueva dependencia | revisión manual: ¿mantenida? ¿cuántas transitivas arrastra? Se justifica en el commit |
| secreto | variable de entorno o gestor. `.env` en `.gitignore` **desde el commit inicial** |

## Execution Steps

1. Antes del primer commit: `.gitignore` + gitleaks verificados. Un secreto commiteado vive para siempre en el histórico.
2. Al añadir un endpoint: comprueba sesión, valida con Zod, limita tamaño de body y escribe el test de `401`.
3. Al encontrar una vulnerabilidad: **primero el test que la demuestra**, después el fix.
4. Al cerrar fase: `npm audit`, gitleaks sobre el histórico y revisión manual de la superficie nueva.

## Output Contract

Cada fase cerrada aporta la salida real de `npm audit` y del escaneo de secretos. Los hallazgos críticos y altos se arreglan **antes** de avanzar.

## References

- `references/controles.md` — tests de seguridad como código y checklist de producción (VPS)
