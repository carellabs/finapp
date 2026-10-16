import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

/**
 * La CSP de las páginas (docker/Caddyfile) no lleva 'unsafe-inline': una página con un
 * `<script>` en línea, un atributo `on*`, un `<style>` o un `style=""` en el HTML dejaría de
 * funcionar en producción, y en desarrollo (sin CSP) nadie lo vería. Estos tests vigilan el
 * `index.html` del código fuente y el que construye Vite.
 */
const RAIZ_WEB = join(import.meta.dirname, '../..');
const URL_TEMA = '/tema-previo.js';

function leerHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** Lo que una CSP sin 'unsafe-inline' bloquearía de un HTML. Vacío = nada. */
function contenidoEnLinea(html: string): string[] {
  const documento = leerHtml(html);
  const hallazgos: string[] = [];

  for (const script of documento.querySelectorAll('script')) {
    if (!script.hasAttribute('src') || (script.textContent ?? '').trim() !== '') {
      hallazgos.push(`<script> en línea: ${(script.textContent ?? '').trim().slice(0, 40)}`);
    }
  }
  for (const elemento of documento.querySelectorAll('*')) {
    for (const atributo of Array.from(elemento.attributes)) {
      const nombre = atributo.name.toLowerCase();
      if (nombre.startsWith('on')) hallazgos.push(`atributo ${nombre} en <${elemento.localName}>`);
      if (nombre === 'style') hallazgos.push(`atributo style en <${elemento.localName}>`);
      if (/^\s*javascript:/i.test(atributo.value)) {
        hallazgos.push(`URL javascript: en ${nombre} de <${elemento.localName}>`);
      }
    }
  }
  for (const _ of documento.querySelectorAll('style')) hallazgos.push('<style> en línea');

  return hallazgos;
}

/** Scripts clásicos (síncronos) de la cabecera, en orden. */
function scriptsClasicosDeLaCabecera(html: string): string[] {
  return Array.from(leerHtml(html).head.querySelectorAll('script'))
    .filter((s) => !s.hasAttribute('type') && !s.hasAttribute('async') && !s.hasAttribute('defer'))
    .map((s) => s.getAttribute('src') ?? '');
}

describe('control positivo: el detector de contenido en línea', () => {
  it('ve un <script> en línea, un atributo on*, un style y una URL javascript:', () => {
    const malo = `<!doctype html><html><head>
      <script>window.x = 1</script>
      <style>body{color:red}</style></head>
      <body onload="x()"><a href="javascript:alert(1)" style="color:red">a</a></body></html>`;

    expect(contenidoEnLinea(malo)).toEqual([
      '<script> en línea: window.x = 1',
      'atributo onload en <body>',
      'URL javascript: en href de <a>',
      'atributo style en <a>',
      '<style> en línea',
    ]);
  });

  it('un <script type="module" src> y un <link> no son contenido en línea', () => {
    const bueno = `<!doctype html><html><head><script src="/tema-previo.js"></script>
      <script type="module" src="/assets/x.js"></script><link rel="stylesheet" href="/x.css">
      </head><body><div id="raiz"></div></body></html>`;

    expect(contenidoEnLinea(bueno)).toEqual([]);
  });
});

describe('web/index.html (fuente)', () => {
  const html = readFileSync(join(RAIZ_WEB, 'index.html'), 'utf8');

  it('no tiene ningún script en línea, ni atributo on*, ni style, ni URL javascript:', () => {
    expect(contenidoEnLinea(html)).toEqual([]);
  });

  it('aplica el tema con un fichero síncrono en la cabecera, ANTES del módulo de React', () => {
    const documento = leerHtml(html);
    const cabecera = Array.from(documento.head.querySelectorAll('script'));

    expect(scriptsClasicosDeLaCabecera(html)).toEqual([URL_TEMA]);
    // Antes que el módulo: si no, hay un primer pintado con el tema equivocado (parpadeo).
    expect(cabecera.map((s) => s.getAttribute('src'))[0]).toBe(URL_TEMA);
  });

  it('el fichero del tema existe en public/ (se copia tal cual al build)', () => {
    expect(() => readFileSync(join(RAIZ_WEB, 'public', URL_TEMA), 'utf8')).not.toThrow();
  });
});

describe('web/public/tema-previo.js', () => {
  /**
   * Ejecuta el script en un contexto vacío, sin más globales que `window` y `document`: lo que
   * ve una página recién abierta. Así se detecta también lo que el script filtre al ámbito global.
   */
  function ejecutar(oscuro: boolean): { contexto: Record<string, unknown>; consultas: string[] } {
    const consultas: string[] = [];
    const contexto: Record<string, unknown> = {
      window: {
        matchMedia: (consulta: string) => {
          consultas.push(consulta);
          return { matches: oscuro };
        },
      },
      document: { documentElement: { dataset: {} as Record<string, string> } },
    };
    const codigo = readFileSync(join(RAIZ_WEB, 'public', 'tema-previo.js'), 'utf8');
    runInNewContext(codigo, contexto);
    return { contexto, consultas };
  }

  const temaFijado = (contexto: Record<string, unknown>): string | undefined =>
    (contexto.document as { documentElement: { dataset: Record<string, string> } }).documentElement
      .dataset.tema;

  it('con el sistema en oscuro fija data-tema="oscuro"', () => {
    const { contexto, consultas } = ejecutar(true);
    expect(temaFijado(contexto)).toBe('oscuro');
    expect(consultas).toEqual(['(prefers-color-scheme: dark)']);
  });

  it('con el sistema en claro fija data-tema="claro"', () => {
    expect(temaFijado(ejecutar(false).contexto)).toBe('claro');
  });

  it('no deja variables globales (corre en el ámbito global de la página)', () => {
    expect(Object.keys(ejecutar(true).contexto)).toEqual(['window', 'document']);
  });
});

describe('web/index.html (construido por Vite)', () => {
  it('tampoco tiene contenido en línea y conserva el script del tema antes del módulo', async () => {
    const salida = await build({
      root: RAIZ_WEB,
      logLevel: 'silent',
      build: { write: false },
    });
    const bundles = Array.isArray(salida) ? salida : [salida];
    const html = bundles
      .flatMap((b) => ('output' in b ? b.output : []))
      .find((o) => o.type === 'asset' && o.fileName === 'index.html');

    expect(html).toBeDefined();
    const texto = String((html as { source: string | Uint8Array }).source);

    // Control positivo: es el HTML construido (el módulo con hash), no el fuente.
    expect(texto).toMatch(/<script type="module"[^>]* src="\/assets\/index-[\w-]+\.js"/);
    expect(contenidoEnLinea(texto)).toEqual([]);
    expect(scriptsClasicosDeLaCabecera(texto)).toEqual([URL_TEMA]);
    expect(texto.indexOf(URL_TEMA)).toBeLessThan(texto.indexOf('type="module"'));
  }, 120_000);
});

describe('el build no inlina assets como data: URI', () => {
  it('un asset pequeño sale como fichero de /assets/, no como data: (la CSP solo admite el propio origen)', async () => {
    // Vite inlina por defecto lo que pese menos de 4 KiB: en producción, un icono o una fuente
    // pequeños acabarían como `data:` y `img-src` / `font-src` ('self') los bloquearía, sin que en
    // desarrollo (sin CSP) se viera. Se construye un proyecto mínimo con la configuración REAL.
    const dir = mkdtempSync(join(tmpdir(), 'finapp-inline-'));
    try {
      writeFileSync(
        join(dir, 'icono.svg'),
        '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
      );
      writeFileSync(
        join(dir, 'main.js'),
        "import icono from './icono.svg'; document.title = icono;",
      );
      writeFileSync(
        join(dir, 'index.html'),
        '<!doctype html><html><body><script type="module" src="/main.js"></script></body></html>',
      );

      const salida = await build({
        root: dir,
        configFile: join(RAIZ_WEB, 'vite.config.ts'),
        logLevel: 'silent',
        build: { write: false },
      });
      const bundles = Array.isArray(salida) ? salida : [salida];
      const ficheros = bundles.flatMap((b) => ('output' in b ? b.output : []));
      const js = ficheros.find((o) => o.type === 'chunk' && o.fileName.endsWith('.js'));

      expect(js).toBeDefined();
      const codigo = (js as { code: string }).code;
      expect(codigo).not.toContain('data:image/svg+xml');
      // Control positivo: el asset se está usando (la ruta al SVG con hash está en el bundle).
      expect(codigo).toMatch(/\/assets\/icono-[\w-]+\.svg/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
