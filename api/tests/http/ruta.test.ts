import { describe, expect, it } from 'vitest';
import { LONGITUD_MAXIMA_DE_RUTA, MARCA_RUTA_TRUNCADA, rutaDePeticion } from '../../src/http/ruta';

/**
 * La ruta que va al log es una cadena libre del cliente (`req.originalUrl` es el texto
 * crudo de la línea de petición): sin esquema, autoridad, query ni fragmento, y con tope.
 */
describe('rutaDePeticion', () => {
  it.each([
    ['/api/v1/x', '/api/v1/x'],
    ['/api/v1/x?mes=2026-06', '/api/v1/x'],
    ['/api/v1/x?token=a&otro=b', '/api/v1/x'],
    ['/api/v1/x?', '/api/v1/x'],
    ['/api/v1/x?a=1?b=2', '/api/v1/x'],
    ['/', '/'],
    ['/?solo=consulta', '/'],
    ['', ''],
    // Fragmento: no viaja por HTTP, pero la línea de petición lo admite como texto.
    ['/x#secreto', '/x'],
    ['/x?a=1#secreto', '/x'],
    ['/x#a?b=secreto', '/x'],
    ['/#secreto', '/'],
    // Un `?` codificado es parte de la ruta, no el principio de la consulta.
    ['/a%3Fb=c', '/a%3Fb=c'],
    ['/a%23b', '/a%23b'],
    // Forma absoluta: sin esquema ni autoridad (y con ella, las credenciales de la URL).
    ['http://user:PASS@host.example/health', '/health'],
    ['https://user:PASS@host.example:8443/a/b?c=d#e', '/a/b'],
    ['HTTP://HOST.EXAMPLE/x', '/x'],
    ['http://host.example', '/'],
    ['http://user:PASS@host.example?x=PASS', '/'],
    ['http://user:PASS@host.example#PASS', '/'],
    // La consulta o el fragmento acaban la autoridad, aunque detrás venga algo que parezca una ruta.
    ['http://host.example?x=/secreto', '/'],
    ['http://host.example#/secreto', '/'],
    ['custom+esquema.1://u:p@h/ruta', '/ruta'],
    // Lo que no es forma absoluta no se toca.
    ['*', '*'],
    ['//otro.example/x', '//otro.example/x'],
    ['/redir/http://user:PASS@h/x', '/redir/http://user:PASS@h/x'],
    ['/redir?u=http://user:PASS@h/x', '/redir'],
  ])('%j -> %j', (url, esperado) => {
    expect(rutaDePeticion(url)).toBe(esperado);
  });

  it('el tope son 200 caracteres: justo el tope no se marca', () => {
    expect(LONGITUD_MAXIMA_DE_RUTA).toBe(200);
    const exacta = `/${'a'.repeat(199)}`;

    expect(rutaDePeticion(exacta)).toBe(exacta);
    expect(rutaDePeticion(`${exacta}?q=1`)).toBe(exacta);
  });

  it('pasado el tope se corta a 200 caracteres y se añade una marca', () => {
    const larga = `/${'a'.repeat(200)}`;

    const ruta = rutaDePeticion(larga);

    expect(MARCA_RUTA_TRUNCADA).toBe('…[truncada]');
    expect(ruta).toBe(larga.slice(0, 200) + MARCA_RUTA_TRUNCADA);
    expect(ruta).toHaveLength(200 + MARCA_RUTA_TRUNCADA.length);
  });

  it('una URL de 15 KB queda en 200 caracteres más la marca, venga o no con consulta', () => {
    const quinceKb = `/${'x'.repeat(15 * 1024)}`;

    for (const url of [quinceKb, `${quinceKb}?${'y'.repeat(1000)}`, `http://u:p@h${quinceKb}`]) {
      const ruta = rutaDePeticion(url);
      expect(ruta).toHaveLength(200 + MARCA_RUTA_TRUNCADA.length);
      expect(ruta.endsWith(MARCA_RUTA_TRUNCADA)).toBe(true);
      expect(ruta).not.toContain('y');
    }
  });

  it('el tope se aplica después de quitar la consulta, no antes', () => {
    const url = `/corta?${'q'.repeat(5000)}`;

    expect(rutaDePeticion(url)).toBe('/corta');
  });
});
