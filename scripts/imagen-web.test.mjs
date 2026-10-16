/**
 * Test de la imagen `web` de produccion (el target `production` de docker/web.Dockerfile):
 * Caddy interno con el build REAL de la web, sin root. Es el complemento de
 * scripts/caddy.test.mjs, que prueba el Caddyfile con un `dist` de mentira.
 *
 * Construye la imagen con una etiqueta PROPIA (`finapp-web:test-14-<pid>-<rand>`, que borra al
 * terminar): `npm run ci` construye `finapp-web:ci` en paralelo desde otros clones, y un test que
 * EJECUTA una imagen no puede depender de que otro no se la pise. Con la cache de capas de Docker
 * solo repite el `vite build`.
 *
 * Lo que prueba y ningun otro test ve:
 *  - que el contenedor arranca SIN root, con el sistema de ficheros en solo lectura y sin
 *    capacidades (lo que pedira el compose de produccion, fase 5), sin errores en el log;
 *  - que el HTML construido no tiene scripts, estilos ni atributos en linea (la CSP no los permite);
 *  - que todo lo que el HTML y el CSS referencian existe y se sirve con la cache que toca;
 *  - que el bundle pide a la API por la ruta RELATIVA /api/v1 (VITE_API_URL), no a localhost:3000;
 *  - que la imagen final no lleva codigo fuente, mapas ni node_modules.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { lanzar } from './procesos.mjs';
import {
  CABECERAS_DE_PAGINA,
  CACHE_INMUTABLE,
  CSP_ESPERADA,
} from './soporte/politica-seguridad.mjs';
import {
  docker,
  dockerDisponible,
  dockerOk,
  EntornoCaddy,
  parsearCsp,
  pedir,
  RAIZ,
  valoresDe,
} from './soporte/caddy-docker.mjs';

const ETIQUETA = `finapp-web:test-14-${process.pid}-${randomBytes(3).toString('hex')}`;

/** Lo que una CSP sin 'unsafe-inline' bloquearia de un HTML. Vacio = nada. */
function contenidoEnLinea(html) {
  const hallazgos = [];
  for (const [, atributos, cuerpo] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc\s*=/.test(atributos) || cuerpo.trim() !== '') hallazgos.push('script en linea');
  }
  if (/<style\b/i.test(html)) hallazgos.push('<style>');
  if (/\sstyle\s*=/i.test(html)) hallazgos.push('atributo style');
  if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(html)) hallazgos.push('atributo on*');
  if (/javascript:/i.test(html)) hallazgos.push('URL javascript:');
  return hallazgos;
}

describe('control positivo: el detector de contenido en linea', () => {
  it('ve un script en linea, un style, un atributo on* y una URL javascript:', () => {
    assert.deepEqual(
      contenidoEnLinea('<script>x()</script><style>a{}</style><body onload="x()" style="a:b">'),
      ['script en linea', '<style>', 'atributo style', 'atributo on*'],
    );
    assert.deepEqual(contenidoEnLinea('<a href="javascript:x()">a</a>'), ['URL javascript:']);
  });

  it('un script con src y un link no son contenido en linea', () => {
    assert.deepEqual(
      contenidoEnLinea('<script src="/a.js"></script><script type="module" src="/b.js"></script>'),
      [],
    );
  });
});

describe('imagen web de produccion', () => {
  const entorno = new EntornoCaddy();
  let base;
  let contenedor;
  let html;

  /** Todo lo que cuelga de /assets/ referenciado por un texto (HTML o CSS). */
  const referencias = (texto) => [
    ...new Set([...texto.matchAll(/(?:src="|href="|url\()(\/[^"')]+)/g)].map((m) => m[1])),
  ];

  before(
    async () => {
      assert.ok(dockerDisponible(), 'Docker no responde: arranca Docker Desktop');

      const construir = lanzar(
        'docker',
        [
          'build',
          '--file',
          'docker/web.Dockerfile',
          '--target',
          'production',
          '--tag',
          ETIQUETA,
          '.',
        ],
        { cwd: RAIZ, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
      );
      assert.equal(
        construir.status,
        0,
        `docker build fallo:\n${String(construir.stderr).slice(-4000)}`,
      );

      entorno.iniciar();
      ({ base, nombre: contenedor } = await entorno.arrancarCaddy({
        imagen: ETIQUETA,
        entorno: { CLOUDFLARED_IP: `${entorno.cloudflaredIp}/32` },
        // Lo que pedira el compose de produccion: sin root (lo fija la imagen), sistema de ficheros
        // de solo lectura con un tmpfs en /tmp, y ninguna capacidad.
        argumentos: [
          '--read-only',
          '--tmpfs',
          '/tmp',
          '--cap-drop',
          'ALL',
          '--security-opt',
          'no-new-privileges',
        ],
      }));
      await entorno.esperarApi(base);
      html = (await pedir(`${base}/`)).cuerpo;
    },
    { timeout: 600_000 },
  );

  // Tambien si se interrumpe el proceso (el entorno ya borra contenedores y red con SIGINT/SIGTERM).
  process.on('exit', () => docker(['rmi', ETIQUETA], { stdio: 'ignore' }));
  after(() => {
    entorno.limpiar();
    docker(['rmi', ETIQUETA], { stdio: 'ignore' });
  });

  it('corre SIN root: el usuario de la imagen es numerico y distinto de 0, y es el del proceso', () => {
    const usuario = dockerOk(['inspect', '--format', '{{.Config.User}}', ETIQUETA]);

    assert.match(usuario, /^\d+(:\d+)?$/);
    assert.notEqual(usuario.split(':')[0], '0');
    assert.equal(dockerOk(['exec', contenedor, 'id', '-u']), usuario.split(':')[0]);
  });

  it('arranca Caddy con el Caddyfile del repo y declara el 8080 (el que escucha)', () => {
    const puertos = JSON.parse(
      dockerOk(['inspect', '--format', '{{json .Config.ExposedPorts}}', ETIQUETA]),
    );

    assert.ok('8080/tcp' in puertos, Object.keys(puertos).join(', '));
    assert.match(
      dockerOk(['inspect', '--format', '{{json .Config.Cmd}}', ETIQUETA]),
      /caddy.*run.*--config.*\/etc\/caddy\/Caddyfile/,
    );
  });

  it('escucha SOLO en el 8080: ni el 80, ni el 443, ni la API de administracion (2019)', () => {
    // La imagen base declara EXPOSE 80, 443 y 2019, y un hijo no puede quitarlos: son metadatos.
    // Lo que importa es lo que de verdad escucha el proceso. Se ignora el 127.0.0.11, el DNS
    // interno de Docker en una red definida por el usuario (puerto aleatorio).
    const escuchando = dockerOk(['exec', contenedor, 'netstat', '-ltn'])
      .split('\n')
      .filter((linea) => /LISTEN/.test(linea))
      .map((linea) => linea.trim().split(/\s+/)[3])
      .filter((direccion) => !direccion.startsWith('127.0.0.11:'))
      .map((direccion) => direccion.split(':').at(-1));

    assert.deepEqual([...new Set(escuchando)], ['8080']);
  });

  it('arranca sin ningun error en el log, ni al escribir /config ni /data (sin root y en solo lectura)', () => {
    const registro = entorno.logs(contenedor);

    // Control positivo: se esta leyendo el log de Caddy.
    assert.ok(registro.includes('serving initial configuration'), registro);
    assert.ok(!/"level":"error"/.test(registro), registro);
    assert.ok(!registro.includes('read-only file system'), registro);
  });

  it('la imagen final no lleva codigo fuente, mapas de fuentes ni node_modules: solo el build', () => {
    const ficheros = dockerOk(['exec', contenedor, 'find', '/srv', '-type', 'f']).split('\n');

    // Control positivo: esta el build.
    assert.ok(ficheros.includes('/srv/index.html'), ficheros.join('\n'));
    assert.ok(ficheros.includes('/srv/tema-previo.js'));
    assert.ok(ficheros.some((f) => /^\/srv\/assets\/index-[\w-]+\.js$/.test(f)));
    assert.deepEqual(
      ficheros.filter((f) => /\.map$|\.tsx?$|node_modules|package\.json|\.env/.test(f)),
      [],
    );
  });

  it('todo /srv/assets/* lleva un hash en el nombre: se sirve como inmutable durante un ano', () => {
    const assets = dockerOk(['exec', contenedor, 'find', '/srv/assets', '-type', 'f']).split('\n');
    const conHash = (f) => /^\/srv\/assets\/[^/]+-[\w-]{8}\.[a-z0-9]+$/.test(f);

    // Control positivo: el detector rechaza un nombre sin hash y acepta los de Vite.
    assert.ok(!conHash('/srv/assets/app.js') && !conHash('/srv/assets/index.js'));
    assert.ok(conHash('/srv/assets/index-BruIkDqB.js'));
    assert.ok(conHash('/srv/assets/eb-garamond-latin-400-normal-BCNrxLz_.woff2'));
    assert.ok(assets.length >= 3, assets.join('\n'));
    assert.deepEqual(
      assets.filter((f) => !conHash(f)),
      [],
    );
  });

  describe('el index.html construido', () => {
    it('no tiene scripts, estilos ni atributos en linea (la CSP no los permite)', () => {
      assert.deepEqual(contenidoEnLinea(html), []);
      // Control positivo: es el HTML construido (el modulo con hash), no el fuente.
      assert.match(html, /<script type="module"[^>]* src="\/assets\/index-[\w-]+\.js"/);
    });

    it('aplica el tema con /tema-previo.js, sincrono y ANTES del modulo de React', () => {
      const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);

      assert.match(scripts[0], /^\s*src="\/tema-previo\.js"\s*$/);
      assert.match(scripts[1], /type="module"/);
    });

    it('todo lo que referencia existe y se sirve: scripts, hoja de estilos y manifiesto', async () => {
      const rutas = referencias(html);

      assert.ok(rutas.length >= 4, rutas.join(', '));
      for (const ruta of rutas) {
        const r = await pedir(`${base}${ruta}`);
        assert.equal(r.estado, 200, ruta);
        assert.ok(!r.cuerpo.startsWith('<!doctype html>'), `${ruta} devuelve el index.html`);
      }
    });
  });

  describe('lo que se sirve con hash en el nombre es inmutable, lo demas se revalida', () => {
    it('los assets de /assets/ llevan Cache-Control immutable', async () => {
      const assets = referencias(html).filter((r) => r.startsWith('/assets/'));

      assert.ok(assets.length >= 2, assets.join(', '));
      for (const ruta of assets) {
        assert.deepEqual(
          valoresDe(await pedir(`${base}${ruta}`), 'cache-control'),
          [CACHE_INMUTABLE],
          ruta,
        );
      }
    });

    for (const ruta of ['/', '/sw.js', '/manifest.webmanifest', '/tema-previo.js']) {
      it(`${ruta} lleva no-cache`, async () => {
        const r = await pedir(`${base}${ruta}`);

        assert.equal(r.estado, 200);
        assert.deepEqual(valoresDe(r, 'cache-control'), ['no-cache']);
      });
    }
  });

  describe('la politica de seguridad sobre el build real', () => {
    it('la CSP y las cabeceras de las paginas son las esperadas, en el HTML, el JS, el CSS y el SW', async () => {
      const jsYCss = referencias(html).filter((r) => r.startsWith('/assets/'));

      for (const ruta of ['/', '/dashboard', '/sw.js', '/tema-previo.js', ...jsYCss]) {
        const r = await pedir(`${base}${ruta}`);

        const csp = valoresDe(r, 'content-security-policy');
        assert.equal(csp.length, 1, `${ruta}: ${csp.length} CSP`);
        assert.deepEqual(parsearCsp(csp[0]), CSP_ESPERADA, ruta);
        for (const [cabecera, valor] of Object.entries(CABECERAS_DE_PAGINA)) {
          assert.deepEqual(valoresDe(r, cabecera), [valor], `${ruta}: ${cabecera}`);
        }
        assert.deepEqual(valoresDe(r, 'server'), [], `${ruta}: Server`);
      }
    });

    it('el CSS no necesita nada que la CSP bloquee: ni data:, ni @import, ni URLs fuera de /assets/', async () => {
      const hoja = referencias(html).find((r) => /^\/assets\/.*\.css$/.test(r));
      assert.ok(hoja, 'el HTML no enlaza ninguna hoja de estilos');
      const css = (await pedir(`${base}${hoja}`)).cuerpo;

      // Control positivo: el CSS referencia ficheros (las fuentes), y esos existen.
      const urls = [...css.matchAll(/url\(([^)]*)\)/g)].map((m) =>
        m[1].replace(/^["']|["']$/g, ''),
      );
      assert.ok(urls.length > 0, 'el CSS no referencia ninguna fuente');
      assert.ok(!/@import/i.test(css), '@import');
      for (const url of urls) {
        assert.match(url, /^\/assets\/[\w.-]+\.woff2?$/, `url(${url}) no es una fuente local`);
        assert.equal((await pedir(`${base}${url}`)).estado, 200, url);
      }
    });

    it('el bundle pide a la API por la ruta RELATIVA /api/v1 (VITE_API_URL), no a localhost:3000', async () => {
      const bundle = referencias(html).find((r) => /^\/assets\/index-[\w-]+\.js$/.test(r));
      assert.ok(bundle, 'el HTML no carga ningun bundle');
      const js = (await pedir(`${base}${bundle}`)).cuerpo;

      assert.ok(js.includes('/api/v1'), 'el bundle no conoce la ruta /api/v1');
      assert.ok(!js.includes('localhost:3000'), 'el bundle lleva una URL absoluta a la API');
      assert.ok(!/https?:\/\/[\w.-]*:3000/.test(js), 'el bundle apunta al puerto de la API');
    });

    it('el bundle no lleva imagenes, fuentes ni medios inlinados como data: (img-src y font-src son self)', async () => {
      const bundle = referencias(html).find((r) => /^\/assets\/index-[\w-]+\.js$/.test(r));
      const js = (await pedir(`${base}${bundle}`)).cuerpo;
      const datos = /data:(?:image|font|audio|video|application\/(?:font|octet-stream))[/;,]/g;

      assert.deepEqual(js.match(datos) ?? [], []);
      // Control positivo: el detector ve un data: URI de una imagen y de una fuente.
      assert.equal('x data:image/svg+xml,y data:font/woff2;base64,z'.match(datos).length, 2);
    });

    it('/api llega a la API tambien con el sistema de ficheros en solo lectura', async () => {
      const r = await pedir(`${base}/api/v1/auth/me`, { cabeceras: { Cookie: 'sid=abc' } });

      assert.equal(r.estado, 200);
      assert.equal(JSON.parse(r.cuerpo).url, '/api/v1/auth/me');
    });
  });
});
