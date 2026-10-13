# Política de seguridad

## Cómo reportar una vulnerabilidad

Usa el reporte privado de GitHub: pestaña **Security** del repositorio, botón **Report a vulnerability**. Solo lo ves tú y el propietario.

Si lo prefieres, escribe a **security@carellabs.com**. En ambos casos, incluye:

- qué has encontrado y dónde (fichero, endpoint o pantalla),
- cómo reproducirlo,
- el impacto que crees que tiene.

**No abras una issue pública** para una vulnerabilidad: cualquiera la vería antes de que haya arreglo.

**No envíes datos financieros reales** (importes, extractos, capturas con cifras propias ni dumps de la base de datos), ni los tuyos ni los de nadie: para reproducir el fallo bastan datos inventados. El repositorio es público.

Responderé en cuanto pueda. Es un proyecto personal, sin SLA.

## Versiones con soporte

Solo la rama `main`. No hay versiones publicadas ni ramas de mantenimiento.

## Alcance

FinApp es una aplicación personal de control de gastos para un solo usuario: una API (Express y Postgres), una web (React) y los Dockerfiles y el CI que las construyen. La amenaza que más importa es el acceso no autorizado a las finanzas de esa persona. Lo más relevante:

- autenticación, sesiones y cookies, validación de entrada y acceso a la base de datos,
- fuga de datos por respuestas de error, logs o dependencias,
- la cadena de dependencias, las imágenes Docker y los workflows de GitHub Actions.

El propio repositorio no contiene datos reales ni secretos: los secretos viven solo en el `.env` local, que está ignorado por git, y el CI escanea el histórico completo en cada PR.
