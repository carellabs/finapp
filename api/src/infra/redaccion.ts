/**
 * Redacción de lo que se escribe en el log (security-engineering, regla 8: los
 * logs son un vector de fuga).
 *
 * Es POR NOMBRE DE CLAVE, sin distinguir mayúsculas ni separadores y a cualquier
 * profundidad. Una redacción por rutas (`req.headers.cookie`) obliga a declarar
 * cada sitio donde puede aparecer un secreto y falla, en silencio, con el que se
 * olvidó; aquí basta con que el dato cuelgue de una clave con ese nombre.
 *
 * Alcance: solo mira CLAVES. No inspecciona el contenido de un texto: un valor
 * como `"sid=abc"` bajo una clave neutra (`mensaje`) sale tal cual. Por eso el
 * código que registra sigue sin volcar cabeceras, cuerpos ni mensajes ajenos.
 */

/** Valor fijo que sustituye a todo lo que cuelga de una clave sensible. */
export const REDACTADO = '[REDACTADO]';
/** Un objeto que ya se está recorriendo más arriba (referencia circular). */
export const MARCA_CICLO = '[CICLO]';
/** Contenedor por debajo de `PROFUNDIDAD_MAXIMA`: no se mira su interior. */
export const MARCA_PROFUNDIDAD = '[PROFUNDIDAD_EXCEDIDA]';
/** Instancia de clase, fecha, `Map`, `Buffer`…: no son datos planos y no se vuelcan. */
export const MARCA_OBJETO = '[OBJETO]';

/**
 * Niveles de anidamiento que se recorren (el objeto raíz es el nivel 0). Lo que
 * cuelga más abajo se sustituye entero: ni se redacta ni se vuelca, así que un
 * cuerpo hostil con miles de niveles no gasta CPU ni pila.
 */
export const PROFUNDIDAD_MAXIMA = 8;

/** Una función: no se llama ni se copia (si no, un `toJSON` propio se ejecutaría al serializar). */
export const MARCA_FUNCION = '[FUNCION]';
/** Se añade a un objeto o array al que se le han quitado claves o elementos por pasar del tope. */
export const MARCA_TRUNCADO = '[TRUNCADO]';

/**
 * Cuántas claves de un objeto y cuántos elementos de un array se recorren. Un cuerpo hostil
 * con un millón de claves no puede bloquear el hilo (medido: 2,2 s). Lo que queda más allá
 * del tope no sale, tampoco lo sensible.
 */
export const MAXIMO_DE_CLAVES = 100;
export const MAXIMO_DE_ELEMENTOS = 100;

/**
 * Fragmentos que delatan una credencial en cualquier parte del nombre. Se buscan
 * sobre el nombre ya normalizado (sin acentos, mayúsculas ni separadores), así que
 * `Set-Cookie`, `set_cookie` y `SETCOOKIE` son lo mismo, y `proxy-authorization`
 * ya cae en `authorization`.
 */
const FRAGMENTOS_DE_CREDENCIAL: readonly string[] = [
  'password',
  'passwd',
  'contrasena',
  'clave',
  'secret',
  'token',
  'cookie',
  'authorization',
  'authentication',
  'credencial',
  'credential',
  'apikey',
  'session',
  'jwt',
  'bearer',
  'databaseurl',
];

/**
 * Nombres que EMPIEZAN así: importes, descripciones, personas y los datos de las
 * columnas del esquema (regla 8). Es por prefijo y no por fragmento para no tocar
 * palabras que solo los contienen (`notificacion` empieza por `noti`, no por `nota`).
 * `importe` cubre `importe_objetivo`; `nombre`, `nombre_usuario`; `margen`,
 * `margen_seguridad`. Un test lee las migraciones y exige que toda columna `numeric` y
 * toda columna de texto personal esté cubierta.
 */
const PREFIJOS_DE_DATO_PRIVADO: readonly string[] = [
  'monto',
  'saldo',
  'importe',
  'amount',
  'adeudado',
  'pagomensual',
  'margen',
  'csm',
  'objetivo',
  'descripcion',
  'persona',
  'nota',
  'concepto',
  'nombre',
  'valor',
];

/** Cualquier importe en céntimos (`monto_cents`, `total_cents`…) acaba así. */
const SUFIJO_DE_IMPORTE = 'cents';

/**
 * Nombres que solo cuentan como una palabra ENTERA del nombre de la clave (separada por
 * lo que no sea una letra o un dígito): la cookie de sesión (`sid`, `connect.sid`,
 * `__Host-sid`) y las cadenas de conexión (`dsn`). Como fragmento marcarían `sidebar`
 * o `inside`.
 */
const PALABRAS_SENSIBLES: readonly string[] = ['sid', 'dsn'];

/**
 * El nombre sin acentos ni diferencias de grafía, en minúsculas. NFKD y no NFD: el ancho
 * completo (`ｐａｓｓｗｏｒｄ`) y otras formas de compatibilidad pasan a su letra de siempre.
 */
function simplificar(clave: string): string {
  return clave.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * ¿El valor que cuelga de esta clave no debe salir nunca en el log?
 *
 * Límite conocido: un homógrafo de otro alfabeto (`pаssword` con una `а` cirílica) NO se
 * reconoce. Las claves salen de este código, no del cliente, así que no hay a quién
 * reprochárselo; un cuerpo hostil solo puede ocultar sus propios datos.
 */
export function esClaveSensible(clave: string): boolean {
  const simple = simplificar(clave);
  const nombre = simple.replace(/[^a-z0-9]/g, '');
  const palabras = simple.split(/[^a-z0-9]+/);
  return (
    palabras.some((palabra) => PALABRAS_SENSIBLES.includes(palabra)) ||
    nombre.endsWith(SUFIJO_DE_IMPORTE) ||
    FRAGMENTOS_DE_CREDENCIAL.some((fragmento) => nombre.includes(fragmento)) ||
    PREFIJOS_DE_DATO_PRIVADO.some((prefijo) => nombre.startsWith(prefijo))
  );
}

function esObjetoPlano(valor: object): boolean {
  const prototipo = Object.getPrototypeOf(valor) as unknown;
  return prototipo === Object.prototype || prototipo === null;
}

function redactarEn(valor: unknown, profundidad: number, ancestros: Set<object>): unknown {
  // JSON no admite `bigint` (lanzaría). Los símbolos los omite él solo.
  if (typeof valor === 'bigint') return valor.toString();
  // Una función no se copia: la copia llevaría un `toJSON` y `JSON.stringify` lo ejecutaría,
  // sacando lo que devuelva sin pasar por la redacción.
  if (typeof valor === 'function') return MARCA_FUNCION;
  if (typeof valor !== 'object' || valor === null) return valor;

  // Un `Error` solo aporta su tipo. Sus propiedades (`detail` de un error de pg) y su
  // mensaje pueden llevar el valor de una fila.
  if (valor instanceof Error) return valor.name;

  const esArray = Array.isArray(valor);
  if (!esArray && !esObjetoPlano(valor)) return MARCA_OBJETO;
  if (profundidad > PROFUNDIDAD_MAXIMA) return MARCA_PROFUNDIDAD;
  // Solo los ANCESTROS cuentan: el mismo objeto en dos ramas distintas no es un ciclo.
  if (ancestros.has(valor)) return MARCA_CICLO;

  ancestros.add(valor);
  try {
    if (esArray) {
      const elementos = valor
        .slice(0, MAXIMO_DE_ELEMENTOS)
        .map((elemento) => redactarEn(elemento, profundidad + 1, ancestros));
      return valor.length > MAXIMO_DE_ELEMENTOS ? [...elementos, MARCA_TRUNCADO] : elementos;
    }

    const propias = valor as Record<string, unknown>;
    const claves = Object.keys(propias);
    const entradas: [string, unknown][] = claves
      .slice(0, MAXIMO_DE_CLAVES)
      .map((clave) => [
        clave,
        esClaveSensible(clave) ? REDACTADO : redactarEn(propias[clave], profundidad + 1, ancestros),
      ]);
    if (claves.length > MAXIMO_DE_CLAVES) {
      entradas.push([MARCA_TRUNCADO, claves.length - MAXIMO_DE_CLAVES]);
    }
    // `fromEntries` define propiedades propias: una clave `__proto__` de un cuerpo JSON
    // es una clave más y no toca el prototipo (con `salida[clave] = …` sí lo haría).
    return Object.fromEntries(entradas);
  } finally {
    ancestros.delete(valor);
  }
}

/**
 * Copia de `valor` sin nada que cuelgue de una clave sensible, sin ciclos ni más de
 * `PROFUNDIDAD_MAXIMA` niveles. No modifica el original.
 *
 * Puede lanzar si un getter del objeto lanza: para escribir en el log se usa
 * `serializarRegistro`, que nunca lo hace.
 */
export function redactar(valor: unknown): unknown {
  return redactarEn(valor, 0, new Set<object>());
}

/** Lo que se escribe si el registro no se puede serializar: fijo, sin datos. */
const LINEA_NO_SERIALIZABLE = JSON.stringify({
  nivel: 'error',
  mensaje: 'registro no serializable',
});

/**
 * Una línea de JSON, redactada, para el log. Es total: un getter que lanza no puede
 * convertir una llamada al log en una excepción (dentro del manejador de errores,
 * Express la contestaría con el detalle del fallo).
 *
 * `JSON.stringify` escapa los saltos de línea de textos y claves (`\n`, `\r`): lo que
 * el cliente envíe no puede añadir al log una línea que parezca de la API.
 */
export function serializarRegistro(campos: Readonly<Record<string, unknown>>): string {
  try {
    return escaparControles(JSON.stringify(redactar(campos)));
  } catch {
    return LINEA_NO_SERIALIZABLE;
  }
}

/**
 * Los C1 (U+0080 a U+009F, con NEL y CSI) y DEL (U+007F), y los separadores de línea y de
 * párrafo de Unicode (U+2028 y U+2029). `JSON.stringify` solo escapa hasta U+001F, y un
 * visor de logs puede tomar NEL o U+2028 por un salto de línea (una línea falsa) y CSI por
 * el inicio de una secuencia de escape de terminal.
 */
const CONTROLES_SIN_ESCAPAR = /[\x7f-\x9f\u{2028}\u{2029}]/gu;

/**
 * Los escapa como `\uXXXX`. Solo pueden estar dentro de un texto del JSON (fuera de uno,
 * `JSON.stringify` no escribe nada que no sea ASCII), así que escaparlos no cambia lo que
 * `JSON.parse` lee de vuelta.
 */
function escaparControles(json: string): string {
  return json.replace(
    CONTROLES_SIN_ESCAPAR,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}
