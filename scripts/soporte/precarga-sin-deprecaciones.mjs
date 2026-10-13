/**
 * Precarga (`node --import`) para los tests de scripts: cualquier DeprecationWarning se
 * convierte en una excepcion SINCRONA, en el punto exacto donde el script la provoca.
 *
 * `--throw-deprecation` no sirve para esto: lanza la excepcion en el siguiente tick, y un script
 * que termina con `process.exit()` (todos los de gates) sale antes y el aviso se pierde.
 */
const emitirOriginal = process.emitWarning;

process.emitWarning = function emitWarning(aviso, ...resto) {
  const opciones = typeof resto[0] === 'object' && resto[0] !== null ? resto[0] : null;
  const tipo = opciones ? opciones.type : resto[0];
  const codigo = opciones ? opciones.code : resto[1];
  if (tipo === 'DeprecationWarning') {
    throw new Error(`[${codigo ?? 'sin codigo'}] DeprecationWarning: ${String(aviso)}`);
  }
  return emitirOriginal.call(process, aviso, ...resto);
};
