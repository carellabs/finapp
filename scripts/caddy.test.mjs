/**
 * Tests del Caddyfile interno (docker/Caddyfile): un solo origen en produccion (issue #14).
 *
 *   navegador -> Cloudflare (TLS) -> cloudflared -> Caddy -> API
 *
 * Necesitan Docker, como los demas tests de scripts/. Usan la imagen de Caddy EXACTA de
 * docker/web.Dockerfile (version y digest), con el Caddyfile del repo, un `dist` de prueba (los
 * nombres con hash son de mentira: aqui se prueba la configuracion, no el build; el build real lo
 * prueba scripts/imagen-web.test.mjs) y una API falsa que devuelve lo que recibe. Todo en una red
 * de Docker propia (ver soporte/caddy-docker.mjs): nada toca compose, sus volumenes ni los
 * puertos 3000 y 5173.
 *
 * Cada directiva de la politica de seguridad tiene su propio test, para que un fallo diga cual.
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { crearTemporales } from './soporte/entorno.mjs';
import {
  CABECERAS_DE_PAGINA,
  CACHE_INMUTABLE,
  CSP_ESPERADA,
} from './soporte/politica-seguridad.mjs';
import {
  dockerDisponible,
  dockerOk,
  docker,
  EntornoCaddy,
  imagenCaddy,
  parsearCsp,
  pedir,
  pedirRechazable,
  RAIZ,
  valoresDe,
} from './soporte/caddy-docker.mjs';

const CADDYFILE = join(RAIZ, 'docker', 'Caddyfile');
const leerCaddyfile = () => readFileSync(CADDYFILE, 'utf8').replace(/\r\n/g, '\n');

const INDEX =
  '<!doctype html><html><head><title>fixture</title></head><body><div id="raiz"></div></body></html>\n';
const ASSET_CON_HASH = '/assets/app-abc123.js';

/** Variables de entorno que el Caddyfile lee al cargarse: `{$NOMBRE` o `{$NOMBRE:defecto}`. */
const variablesDelCaddyfile = (texto) =>
  [...new Set([...texto.matchAll(/\{\$(\w+)/g)].map((m) => m[1]))].sort();

/**
 * Ejecuta `caddy <orden>` con el Caddyfile del repo dentro de la imagen oficial y devuelve el
 * resultado. El fichero entra por la entrada estandar (sin bind mounts).
 */
function caddyConElCaddyfile(orden, entorno = {}) {
  const variables = Object.entries(entorno).flatMap(([k, v]) => ['--env', `${k}=${v}`]);
  return docker(
    [
      'run',
      '--rm',
      '-i',
      ...variables,
      imagenCaddy(),
      'sh',
      '-c',
      `cat > /tmp/Caddyfile; ${orden}`,
    ],
    { input: readFileSync(CADDYFILE) },
  );
}

describe('Caddyfile: la configuracion', () => {
  before(() => {
    assert.ok(dockerDisponible(), 'Docker no responde: arranca Docker Desktop');
  });

  it('es valida para la imagen de Caddy fijada, con CLOUDFLARED_IP como IP o como CIDR', () => {
    for (const valor of ['172.30.0.3/32', '172.30.0.3']) {
      const r = caddyConElCaddyfile('caddy validate --config /tmp/Caddyfile --adapter caddyfile', {
        CLOUDFLARED_IP: valor,
      });

      assert.equal(r.status, 0, `${valor}: ${r.stdout}${r.stderr}`);
      assert.match(`${r.stdout}${r.stderr}`, /Valid configuration/);
    }
  });

  it('SIN CLOUDFLARED_IP (o vacia, o sin ser una IP) Caddy se niega a cargarla: falla en alto', () => {
    const validar = 'caddy validate --config /tmp/Caddyfile --adapter caddyfile';

    const sin = caddyConElCaddyfile(validar);
    assert.notEqual(sin.status, 0, 'cargo sin CLOUDFLARED_IP');
    assert.match(`${sin.stdout}${sin.stderr}`, /FALTA_CLOUDFLARED_IP/);

    for (const valor of ['', 'basura']) {
      const r = caddyConElCaddyfile(validar, { CLOUDFLARED_IP: valor });
      assert.notEqual(r.status, 0, `cargo con CLOUDFLARED_IP=${JSON.stringify(valor)}`);
      assert.match(`${r.stdout}${r.stderr}`, /remote_ip|invalid IP address/);
    }
  });

  it('esta formateado como lo deja `caddy fmt` (una sola forma de escribirlo)', () => {
    const r = caddyConElCaddyfile('caddy fmt /tmp/Caddyfile');

    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, leerCaddyfile());
  });

  describe('la configuracion adaptada a JSON (lo que Caddy carga de verdad)', () => {
    const adaptar = (entorno) => {
      const r = caddyConElCaddyfile('caddy adapt --config /tmp/Caddyfile --adapter caddyfile', {
        CLOUDFLARED_IP: '172.30.0.3/32',
        ...entorno,
      });
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(r.stdout);
    };

    it('un solo servidor en el :8080, sin API de administracion, sin HTTPS automatico y sin autoguardado', () => {
      const config = adaptar({});
      const servidores = Object.values(config.apps.http.servers);

      assert.equal(servidores.length, 1);
      assert.deepEqual(servidores[0].listen, [':8080']);
      assert.equal(config.admin.disabled, true);
      assert.equal(config.admin.config.persist, false);
      // Sin esto, un sitio con nombre de dominio que se anadiera despues pediria certificados y
      // abriria el 80 y el 443: Cloudflare ya termina TLS.
      assert.equal(servidores[0].automatic_https.disable, true);
    });

    it('el log filtra, como lista blanca, las cabeceras, las IP y la consulta (tambien en los accesos)', () => {
      const registro = adaptar({}).logging.logs.default.encoder;

      assert.equal(registro.format, 'filter');
      assert.equal(registro.wrap.format, 'json');
      assert.deepEqual(registro.fields, {
        'request>headers': { filter: 'delete' },
        resp_headers: { filter: 'delete' },
        'request>remote_ip': { filter: 'delete' },
        'request>remote_port': { filter: 'delete' },
        'request>client_ip': { filter: 'delete' },
        'request>uri': { filter: 'regexp', regexp: '[?].*' },
      });
    });

    it('la API esta en api:3000 por defecto (el servicio de compose) y API_UPSTREAM lo cambia', () => {
      const destinos = (config) =>
        [...JSON.stringify(config).matchAll(/"dial":"([^"]+)"/g)].map((m) => m[1]);

      assert.deepEqual(destinos(adaptar({})), ['api:3000']);
      assert.deepEqual(destinos(adaptar({ API_UPSTREAM: 'otra-api:4000' })), ['otra-api:4000']);
    });

    it('la CLOUDFLARED_IP llega al matcher de CF-Connecting-IP (la unica IP de confianza)', () => {
      const rangos = (config) =>
        [...JSON.stringify(config).matchAll(/"remote_ip":\{"ranges":\[([^\]]*)\]/g)].map(
          (m) => m[1],
        );

      assert.deepEqual(rangos(adaptar({})), ['"172.30.0.3/32"']);
      assert.deepEqual(rangos(adaptar({ CLOUDFLARED_IP: '10.1.2.3/32' })), ['"10.1.2.3/32"']);
    });
  });

  it('solo lee CLOUDFLARED_IP y API_UPSTREAM del entorno, y env.example las documenta', () => {
    assert.deepEqual(variablesDelCaddyfile(leerCaddyfile()), ['API_UPSTREAM', 'CLOUDFLARED_IP']);

    const envExample = readFileSync(join(RAIZ, 'env.example'), 'utf8');
    for (const variable of ['CLOUDFLARED_IP', 'API_UPSTREAM']) {
      assert.match(envExample, new RegExp(`^# ${variable}=`, 'm'), `env.example sin ${variable}`);
    }
  });
});

describe('Caddy en marcha, con la imagen oficial y el Caddyfile del repo', () => {
  const temporales = crearTemporales();
  const entorno = new EntornoCaddy();
  let base;
  let nombreCaddy;

  /** Cada peticion al Caddy bajo prueba. */
  const pedirACaddy = (ruta, opciones) => pedir(`${base}${ruta}`, opciones);
  /** Para un cuerpo que Caddy rechaza (413) y cierra sin esperar a que acabe el envio: tolera el EPIPE. */
  const pedirRechazadoACaddy = (ruta, opciones) => pedirRechazable(`${base}${ruta}`, opciones);
  /** La API falsa devuelve lo que ha recibido: `{ metodo, url, cabeceras, remoto, cuerpo }`. */
  const eco = (respuesta) => JSON.parse(respuesta.cuerpo);

  before(async () => {
    assert.ok(dockerDisponible(), 'Docker no responde: arranca Docker Desktop');
    const dist = temporales.crear('finapp-caddy-dist-');
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), INDEX);
    writeFileSync(join(dist, ASSET_CON_HASH.slice(1)), "console.log('app');\n");
    writeFileSync(join(dist, 'sw.js'), "self.addEventListener('install', () => {});\n");
    writeFileSync(join(dist, 'manifest.webmanifest'), '{"name":"FinApp"}\n');
    writeFileSync(
      join(dist, 'tema-previo.js'),
      "document.documentElement.dataset.tema = 'claro';\n",
    );
    // Ficheros ocultos que no deben salir nunca (un `.env` que se colara en el dist, un `.map`...).
    writeFileSync(join(dist, '.env'), 'VITE_SECRETO=no-debe-salir\n');
    writeFileSync(join(dist, 'assets', '.oculto.js'), "console.log('oculto');\n");

    entorno.iniciar();
    ({ base, nombre: nombreCaddy } = await entorno.arrancarCaddy({
      imagen: imagenCaddy(),
      // Solo el contenedor `cloudflared` de mentira es de confianza.
      entorno: { CLOUDFLARED_IP: `${entorno.cloudflaredIp}/32` },
      ficheros: [
        { origen: CADDYFILE, destino: '/etc/caddy/Caddyfile' },
        // `/.` copia el CONTENIDO del directorio, no el directorio.
        { origen: `${dist.replaceAll('\\', '/')}/.`, destino: '/srv/' },
      ],
    }));
    await entorno.esperarApi(base);
  });

  after(() => {
    entorno.limpiar();
    temporales.borrarTodas();
  });

  describe('los estaticos y el fallback del router', () => {
    it('sirve index.html en /', async () => {
      const r = await pedirACaddy('/');

      assert.equal(r.estado, 200);
      assert.match(r.cabeceras['content-type'], /^text\/html/);
      assert.equal(r.cuerpo, INDEX);
    });

    for (const ruta of [
      '/dashboard',
      '/objetivos',
      '/analisis/2026-10',
      '/no/existe/en/el/router',
    ]) {
      it(`una ruta del router (${ruta}) devuelve index.html con 200: fallback para la SPA`, async () => {
        const r = await pedirACaddy(ruta);

        assert.equal(r.estado, 200);
        assert.equal(r.cuerpo, INDEX);
      });
    }

    it('un HEAD de una ruta del router tambien es 200', async () => {
      const r = await pedirACaddy('/dashboard', { metodo: 'HEAD' });

      assert.equal(r.estado, 200);
      assert.equal(r.cuerpo, '');
    });

    it('un asset que existe se sirve tal cual (no index.html)', async () => {
      const r = await pedirACaddy(ASSET_CON_HASH);

      assert.equal(r.estado, 200);
      assert.equal(r.cuerpo, "console.log('app');\n");
      assert.match(r.cabeceras['content-type'], /javascript/);
    });

    it('un asset que NO existe es un 404 sin cuerpo, no el index.html: el navegador lo leeria como JS', async () => {
      const r = await pedirACaddy('/assets/no-existe-abc123.js');

      assert.equal(r.estado, 404);
      assert.equal(r.cuerpo, '');
    });

    it('un POST a los estaticos no llega a la API: es un 405', async () => {
      const r = await pedirACaddy('/dashboard', { metodo: 'POST', cuerpo: '{}' });

      assert.equal(r.estado, 405);
      assert.equal(r.cabeceras['x-eco-api'], undefined, 'llego a la API');
    });

    // Solo las rutas SIN punto van al router. Lo demas es un fichero: si existe se sirve y si no,
    // un 404 de verdad (un /favicon.ico o un /robots.txt que devolvieran el index.html con 200
    // despistan a navegadores, rastreadores y escaneres).
    for (const ruta of [
      '/favicon.ico',
      '/robots.txt',
      '/.git/config',
      '/x.js',
      '/sw.js.map',
      '/analisis/2026.10',
    ]) {
      it(`${ruta} (tiene un punto y no existe) es un 404 sin cuerpo, no el index.html`, async () => {
        const r = await pedirACaddy(ruta);

        assert.equal(r.estado, 404);
        assert.equal(r.cuerpo, '');
        assert.deepEqual(valoresDe(r, 'cache-control'), ['no-store']);
      });
    }

    it('los ficheros con punto que SI existen se sirven (control de lo anterior)', async () => {
      for (const [ruta, contenido] of [
        ['/sw.js', "self.addEventListener('install', () => {});\n"],
        ['/manifest.webmanifest', '{"name":"FinApp"}\n'],
        ['/tema-previo.js', "document.documentElement.dataset.tema = 'claro';\n"],
      ]) {
        const r = await pedirACaddy(ruta);

        assert.equal(r.estado, 200, ruta);
        assert.equal(r.cuerpo, contenido, ruta);
      }
    });

    it('los ficheros ocultos no se sirven aunque EXISTAN en el dist (.env, assets/.oculto.js)', async () => {
      // Control positivo: estan de verdad en el contenedor.
      const enElContenedor = dockerOk(['exec', nombreCaddy, 'sh', '-c', 'ls -A /srv /srv/assets']);
      assert.match(enElContenedor, /^\.env$/m);
      assert.match(enElContenedor, /^\.oculto\.js$/m);

      for (const ruta of ['/.env', '/assets/.oculto.js']) {
        const r = await pedirACaddy(ruta);

        assert.equal(r.estado, 404, ruta);
        assert.ok(!r.cuerpo.includes('no-debe-salir') && !r.cuerpo.includes('oculto'), ruta);
      }
    });

    it('/health y solo /health (exacto) se proxia a la API; /healthz y /health/x son del router', async () => {
      const r = await pedirACaddy('/health');

      assert.equal(r.estado, 200);
      assert.equal(eco(r).url, '/health');
      assert.deepEqual(valoresDe(r, 'x-eco-api'), ['si']);
      for (const ruta of ['/healthz', '/health/x']) {
        const otra = await pedirACaddy(ruta);
        assert.equal(otra.cuerpo, INDEX, ruta);
        assert.equal(otra.cabeceras['x-eco-api'], undefined, ruta);
      }
    });
  });

  describe('/api va a la API, sin reescribir la ruta', () => {
    it('reenvia metodo, ruta, consulta, cuerpo, Origin, Cookie y Host intactos', async () => {
      const r = await pedirACaddy('/api/v1/auth/login?recordar=1&x=%C3%B1', {
        metodo: 'POST',
        cabeceras: {
          'Content-Type': 'application/json',
          Origin: 'https://finanzas.carellabs.com',
          Cookie: 'sid=abc',
        },
        cuerpo: '{"nombreUsuario":"a"}',
      });
      const recibido = eco(r);

      assert.equal(r.estado, 200);
      assert.equal(recibido.metodo, 'POST');
      assert.equal(recibido.url, '/api/v1/auth/login?recordar=1&x=%C3%B1');
      assert.equal(recibido.cuerpo, '{"nombreUsuario":"a"}');
      // Lo que mira `verificarOrigen` (CSRF) y la sesion llega intacto.
      assert.equal(recibido.cabeceras.origin, 'https://finanzas.carellabs.com');
      assert.equal(recibido.cabeceras.cookie, 'sid=abc');
      assert.equal(recibido.cabeceras.host, base.replace('http://', ''));
    });

    for (const metodo of ['GET', 'PATCH', 'PUT', 'DELETE']) {
      it(`${metodo} /api/v1/transacciones/42 llega como ${metodo} a la misma ruta`, async () => {
        const r = await pedirACaddy('/api/v1/transacciones/42', { metodo });

        assert.equal(eco(r).metodo, metodo);
        assert.equal(eco(r).url, '/api/v1/transacciones/42');
      });
    }

    it('/api y /api/ tambien son de la API; /apix NO: esa es una ruta del router', async () => {
      assert.equal(eco(await pedirACaddy('/api')).url, '/api');
      assert.equal(eco(await pedirACaddy('/api/')).url, '/api/');

      const otra = await pedirACaddy('/apix/v1');
      assert.equal(otra.cuerpo, INDEX);
      assert.equal(otra.cabeceras['x-eco-api'], undefined);
    });

    it('las respuestas de la API conservan SUS cabeceras (las de helmet): una sola vez y sin las de las paginas', async () => {
      const r = await pedirACaddy('/api/v1/meses');

      // Las pone la API falsa, como helmet pone las suyas: Caddy no las duplica ni las cambia.
      assert.deepEqual(valoresDe(r, 'content-security-policy'), ["default-src 'none'"]);
      assert.deepEqual(valoresDe(r, 'strict-transport-security'), [
        'max-age=31536000; includeSubDomains',
      ]);
      assert.deepEqual(valoresDe(r, 'x-eco-api'), ['si']);
      // Las de las PAGINAS no se aplican a /api (si no, se duplicarian o se contradirian).
      for (const cabecera of [
        'referrer-policy',
        'permissions-policy',
        'cross-origin-opener-policy',
        'x-content-type-options',
        'cache-control',
      ]) {
        assert.deepEqual(valoresDe(r, cabecera), [], `Caddy anade ${cabecera} a /api`);
      }
    });

    it('un cuerpo de mas de 1 MB lo rechaza Caddy con 413 y NO llega a la API; uno de 900 kB pasa', async () => {
      // La API limita el JSON a 100 kB: lo que pase de 1 MB no es una peticion de la app, y asi
      // Caddy no reenvia decenas de MB a la API solo para que los rechace.
      const cabeceras = { 'Content-Type': 'application/json' };
      const grande = await pedirRechazadoACaddy('/api/v1/transacciones', {
        metodo: 'POST',
        cabeceras,
        cuerpo: 'x'.repeat(2_000_000),
      });
      assert.equal(grande.estado, 413);
      assert.equal(grande.cabeceras['x-eco-api'], undefined, 'el cuerpo llego a la API');

      // Sin Content-Length (troceado) tambien: el tope no depende de que el cliente declare el tamano.
      const troceado = await pedirRechazadoACaddy('/api/v1/transacciones', {
        metodo: 'POST',
        cabeceras,
        cuerpo: 'x'.repeat(3_000_000),
        troceado: true,
      });
      assert.equal(troceado.estado, 413);
      assert.equal(troceado.cabeceras['x-eco-api'], undefined, 'el cuerpo troceado llego a la API');

      const razonable = await pedirACaddy('/api/v1/transacciones', {
        metodo: 'POST',
        cabeceras,
        cuerpo: 'x'.repeat(900_000),
      });
      assert.equal(razonable.estado, 200);
      assert.equal(eco(razonable).cuerpo.length, 900_000);
    });

    it('Caddy no se anuncia en lo que viene de la API: ni Server ni Via', async () => {
      const r = await pedirACaddy('/api/v1/meses');

      assert.deepEqual(valoresDe(r, 'server'), []);
      assert.deepEqual(valoresDe(r, 'via'), []);
      // Control positivo: la API SI ve el Via que Caddy le anade en la peticion (el test ve la cabecera).
      assert.equal(eco(r).cabeceras.via, '1.1 Caddy');
    });
  });

  describe('CF-Connecting-IP solo se reenvia si la peticion llega de cloudflared', () => {
    it('desde cualquier otro extremo (aqui, el host) se DESCARTA, aunque venga repetida', async () => {
      const r = await pedirACaddy('/api/v1/meses', {
        cabeceras: { 'CF-Connecting-IP': ['1.2.3.4', '5.6.7.8'], 'X-Forwarded-For': '9.9.9.9' },
      });
      const recibido = eco(r);

      assert.equal(recibido.cabeceras['cf-connecting-ip'], undefined);
      // Y el X-Forwarded-For del cliente tampoco cuela: Caddy pone el extremo real.
      assert.ok(!recibido.cabeceras['x-forwarded-for'].includes('9.9.9.9'));
    });

    it('desde cloudflared SE REENVIA intacta (control positivo: si no, el descarte seria que nunca llega)', () => {
      const r = entorno.desdeCloudflared(`http://${nombreCaddy}:8080/api/v1/meses`, {
        'CF-Connecting-IP': '1.2.3.4',
        'X-Forwarded-For': '9.9.9.9',
      });
      const recibido = JSON.parse(r.cuerpo);

      assert.equal(r.estado, 200);
      assert.equal(recibido.cabeceras['cf-connecting-ip'], '1.2.3.4');
      assert.equal(recibido.cabeceras['x-forwarded-for'], entorno.cloudflaredIp);
    });
  });

  describe('el resto de cabeceras con las que alguien podria falsificar su IP o su origen', () => {
    // Las que fija Cloudflare (y la API podria leer algun dia): solo desde cloudflared, como
    // CF-Connecting-IP. Las que nadie legitimo pone y la API no lee: nunca.
    const DE_CLOUDFLARE = {
      'CF-Connecting-IPv6': '2001:db8::1',
      'True-Client-IP': '1.2.3.4',
    };
    const NUNCA = {
      'X-Real-IP': '1.2.3.4',
      Forwarded: 'for=1.2.3.4;proto=https;host=evil.example',
      'X-Forwarded-Port': '443',
    };
    const MINUSCULAS = (objeto) => Object.keys(objeto).map((n) => n.toLowerCase());

    it('desde cualquier otro extremo no llega ninguna de ellas a la API', async () => {
      const r = await pedirACaddy('/api/v1/meses', {
        cabeceras: { ...DE_CLOUDFLARE, ...NUNCA, 'CF-Connecting-IP': '1.2.3.4' },
      });
      const recibidas = eco(r).cabeceras;

      for (const nombre of [...MINUSCULAS(DE_CLOUDFLARE), ...MINUSCULAS(NUNCA)]) {
        assert.equal(recibidas[nombre], undefined, `${nombre} llego a la API`);
      }
    });

    it('desde cloudflared pasan las de Cloudflare (control positivo) y siguen sin pasar las otras', () => {
      const r = entorno.desdeCloudflared(`http://${nombreCaddy}:8080/api/v1/meses`, {
        ...DE_CLOUDFLARE,
        ...NUNCA,
      });
      const recibidas = JSON.parse(r.cuerpo).cabeceras;

      assert.equal(r.estado, 200);
      assert.equal(recibidas['cf-connecting-ipv6'], '2001:db8::1');
      assert.equal(recibidas['true-client-ip'], '1.2.3.4');
      for (const nombre of MINUSCULAS(NUNCA)) {
        assert.equal(recibidas[nombre], undefined, `${nombre} llego a la API`);
      }
    });

    it('X-Forwarded-For, -Host y -Proto los fija Caddy: el valor del cliente no sobrevive, venga de donde venga', async () => {
      const falsas = {
        'X-Forwarded-For': '9.9.9.9',
        'X-Forwarded-Host': 'evil.example',
        'X-Forwarded-Proto': 'https',
      };
      const delHost = eco(await pedirACaddy('/api/v1/meses', { cabeceras: falsas })).cabeceras;
      const deCloudflared = JSON.parse(
        entorno.desdeCloudflared(`http://${nombreCaddy}:8080/api/v1/meses`, falsas).cuerpo,
      ).cabeceras;

      for (const recibidas of [delHost, deCloudflared]) {
        assert.ok(!recibidas['x-forwarded-for'].includes('9.9.9.9'));
        assert.notEqual(recibidas['x-forwarded-host'], 'evil.example');
        assert.equal(recibidas['x-forwarded-proto'], 'http');
      }
      assert.equal(delHost['x-forwarded-host'], base.replace('http://', ''));
    });
  });

  describe('cabeceras de seguridad de las paginas', () => {
    const PAGINAS = [
      ['/', 'la raiz'],
      ['/dashboard', 'una ruta del router (fallback)'],
      ['/favicon.ico', 'un 404 de un fichero con punto'],
      ['/.env', 'un fichero oculto'],
      [ASSET_CON_HASH, 'un asset con hash'],
      ['/sw.js', 'el service worker'],
      ['/manifest.webmanifest', 'el manifiesto'],
      ['/tema-previo.js', 'el script del tema'],
      ['/assets/no-existe-abc123.js', 'un 404 de asset'],
    ];

    for (const [directiva, fuentes] of Object.entries(CSP_ESPERADA)) {
      it(`la CSP lleva ${directiva} ${fuentes.join(' ')}`, async () => {
        for (const [ruta, descripcion] of PAGINAS) {
          const r = await pedirACaddy(ruta);
          const csp = valoresDe(r, 'content-security-policy');

          assert.equal(csp.length, 1, `${descripcion}: ${csp.length} CSP`);
          assert.deepEqual(parsearCsp(csp[0])[directiva], fuentes, `${descripcion}: ${directiva}`);
        }
      });
    }

    it('la CSP no tiene mas directivas que esas, ni unsafe-inline, unsafe-eval, comodines ni data:', async () => {
      const r = await pedirACaddy('/');
      const csp = parsearCsp(valoresDe(r, 'content-security-policy')[0]);

      assert.deepEqual(csp, CSP_ESPERADA);
      const fuentes = Object.values(csp).flat();
      // Control positivo: la lista se esta leyendo (hay fuentes que mirar).
      assert.ok(fuentes.includes("'self'") && fuentes.includes("'none'"));
      for (const prohibida of [
        "'unsafe-inline'",
        "'unsafe-eval'",
        '*',
        'data:',
        'http:',
        'https:',
      ]) {
        assert.ok(!fuentes.includes(prohibida), `la CSP admite ${prohibida}`);
      }
    });

    for (const [cabecera, valor] of Object.entries(CABECERAS_DE_PAGINA)) {
      it(`${cabecera}: ${valor}`, async () => {
        for (const [ruta, descripcion] of PAGINAS) {
          const r = await pedirACaddy(ruta);

          assert.deepEqual(valoresDe(r, cabecera), [valor], `${descripcion}: ${cabecera}`);
        }
      });
    }

    it('la HSTS no lleva preload (no se puede deshacer) y su max-age es de un ano', async () => {
      const [valor] = valoresDe(await pedirACaddy('/'), 'strict-transport-security');

      assert.ok(!/preload/i.test(valor), valor);
      assert.match(valor, /^max-age=31536000(;|$)/);
    });

    it('Caddy no se anuncia en las paginas: ni Server ni Via, tambien en los 404', async () => {
      for (const [ruta, descripcion] of PAGINAS) {
        const r = await pedirACaddy(ruta);

        assert.deepEqual(valoresDe(r, 'server'), [], `${descripcion}: Server`);
        assert.deepEqual(valoresDe(r, 'via'), [], `${descripcion}: Via`);
      }
      // Control positivo: sin `header -Server` Caddy si lo anuncia (lo hace con sus propios errores).
      const propio = await pedirACaddy('/dashboard', { metodo: 'POST' });
      assert.equal(propio.estado, 405);
      assert.deepEqual(valoresDe(propio, 'server'), ['Caddy']);
    });
  });

  describe('cache', () => {
    it('los assets con hash en el nombre son inmutables: un ano', async () => {
      const r = await pedirACaddy(ASSET_CON_HASH);

      assert.deepEqual(valoresDe(r, 'cache-control'), [CACHE_INMUTABLE]);
    });

    for (const ruta of ['/', '/dashboard', '/sw.js', '/manifest.webmanifest', '/tema-previo.js']) {
      it(`${ruta} se revalida siempre: no-cache (no lleva hash en el nombre)`, async () => {
        const r = await pedirACaddy(ruta);

        assert.deepEqual(valoresDe(r, 'cache-control'), ['no-cache']);
        // Con no-cache el navegador revalida, y para eso necesita el validador.
        assert.ok(r.cabeceras.etag, 'sin ETag no hay revalidacion barata');
      });
    }

    it('un asset que no existe NO es inmutable: un 404 no se cachea', async () => {
      const r = await pedirACaddy('/assets/no-existe-abc123.js');

      assert.equal(r.estado, 404);
      assert.deepEqual(valoresDe(r, 'cache-control'), ['no-store']);
    });

    it('revalidar un asset con If-None-Match da 304', async () => {
      const primera = await pedirACaddy('/');
      const r = await pedirACaddy('/', { cabeceras: { 'If-None-Match': primera.cabeceras.etag } });

      assert.equal(r.estado, 304);
    });
  });

  describe('lo que no debe quedar abierto', () => {
    it('la API de administracion de Caddy esta apagada (admin off): no escucha en el 2019', () => {
      // Control positivo: el mismo cliente SI llega al puerto 8080 del contenedor.
      const vivo = docker([
        'exec',
        nombreCaddy,
        'wget',
        '-q',
        '-O',
        '/dev/null',
        'http://127.0.0.1:8080/',
      ]);
      assert.equal(vivo.status, 0, vivo.stderr);

      const admin = docker([
        'exec',
        nombreCaddy,
        'wget',
        '-q',
        '-O',
        '-',
        'http://127.0.0.1:2019/config/',
      ]);
      assert.notEqual(admin.status, 0, 'la API de administracion responde');
    });

    it('no guarda configuracion en /config (persist_config off): el arranque no autoguarda', () => {
      const registro = entorno.logs(nombreCaddy);

      assert.ok(registro.includes('serving initial configuration'), 'no se leen los logs de Caddy');
      assert.ok(!registro.includes('autosaved config'), 'Caddy autoguarda su configuracion');
    });
  });

  describe('el log de errores de Caddy no vuelca cabeceras, IP ni consulta', () => {
    // Detras de Cloudflare y Access, las cabeceras de una peticion llevan la IP del cliente, su
    // correo y su JWT de Access: un log con ellas incumple la regla 8 (logs sin datos personales).
    // El criterio es de LISTA BLANCA: se borran contenedores enteros (`request>headers`), no
    // cabeceras con nombre, para que una cabecera nueva no se cuele.
    const SECRETOS = {
      ipDelCliente: '203.0.113.77',
      jwt: 'jwt-de-access-SECRETO-123',
      correo: 'persona-secreta@ejemplo.test',
      inventada: 'valor-inventado-456',
      consulta: 'valor-de-consulta-789',
      cookie: 'cookie-SECRETA-321',
      autorizacion: 'token-SECRETO-654',
    };

    /** El Caddy de la API CAIDA (su destino no existe): cada /api da un 502 y Caddy lo registra. */
    let caido;
    before(async () => {
      caido = await entorno.arrancarCaddy({
        imagen: imagenCaddy(),
        entorno: {
          CLOUDFLARED_IP: `${entorno.cloudflaredIp}/32`,
          API_UPSTREAM: 'api-que-no-existe:3000',
        },
        ficheros: [{ origen: CADDYFILE, destino: '/etc/caddy/Caddyfile' }],
        sufijoNombre: 'sin-api',
      });
    });

    /** Provoca un 502 con todos los datos de cliente de SECRETOS y devuelve el log de Caddy. */
    async function provocarUn502() {
      const r = await pedir(`${caido.base}/api/v1/dashboard?mes=2026-10&x=${SECRETOS.consulta}`, {
        cabeceras: {
          'Cf-Connecting-Ip': SECRETOS.ipDelCliente,
          'Cf-Access-Jwt-Assertion': SECRETOS.jwt,
          'Cf-Access-Authenticated-User-Email': SECRETOS.correo,
          'X-Cabecera-Inventada': SECRETOS.inventada,
          Cookie: `sid=${SECRETOS.cookie}`,
          Authorization: `Bearer ${SECRETOS.autorizacion}`,
        },
      });
      assert.equal(r.estado, 502);
      for (let intento = 0; intento < 40; intento += 1) {
        const registro = entorno.logs(caido.nombre);
        if (registro.includes('"status":502')) return registro;
        await new Promise((listo) => setTimeout(listo, 250));
      }
      throw new Error(`Caddy no registro el 502:\n${entorno.logs(caido.nombre)}`);
    }

    it('con la API caida, el 502 se registra con metodo, ruta, estado y error, y nada del cliente', async () => {
      // La IP del cliente es la del extremo que ve Caddy (la puerta de enlace de la red de Docker).
      const ipReal = eco(await pedirACaddy('/api/v1/ip')).cabeceras['x-forwarded-for'];
      const registro = await provocarUn502();

      const linea = registro.split('\n').find((l) => l.includes('"status":502'));
      const entrada = JSON.parse(linea);
      // Lo que SI queda: lo que hace falta para diagnosticar.
      assert.equal(entrada.level, 'error');
      assert.equal(entrada.status, 502);
      assert.equal(entrada.request.method, 'GET');
      assert.equal(entrada.request.uri, '/api/v1/dashboard', 'la ruta, sin la consulta');
      assert.ok(entrada.msg, 'sin mensaje de error');
      assert.ok(entrada.duration >= 0);
      // Lo que NO: ni los contenedores enteros, ni cada valor suelto en ninguna parte del log.
      for (const campo of ['headers', 'remote_ip', 'remote_port', 'client_ip']) {
        assert.equal(entrada.request[campo], undefined, `request.${campo} sigue en el log`);
      }
      assert.equal(entrada.resp_headers, undefined);
      for (const [nombre, valor] of Object.entries(SECRETOS)) {
        assert.ok(!registro.includes(valor), `el log contiene ${nombre}`);
      }
      assert.ok(!registro.includes('mes=2026-10'), 'el log contiene la consulta');
      const comoIp = new RegExp(`(?<![\\d.])${ipReal.replaceAll('.', '\\.')}(?!\\d)`);
      assert.ok(!comoIp.test(registro), `el log contiene la IP del cliente (${ipReal})`);
    });

    it('el resto del log (el arranque) sigue ahi: el filtro no calla a Caddy', async () => {
      const registro = await provocarUn502();

      assert.ok(registro.includes('serving initial configuration'));
    });
  });
});
