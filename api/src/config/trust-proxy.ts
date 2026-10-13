import { BlockList, isIP } from 'node:net';

/**
 * Valor que la API le pasa a `app.set('trust proxy', …)`.
 *
 * Solo hay dos formas, y ninguna es `true` ni un número de saltos:
 *  - `false`: no se confía en ningún proxy (desarrollo: el navegador va directo).
 *  - una lista de nombres de Express (`loopback`, `linklocal`, `uniquelocal`),
 *    IPs o subredes CIDR PRIVADAS: los SALTOS de los que se acepta que reenvíen
 *    la petición. Es una lista y no un número porque con `app.set('trust proxy', 1)`
 *    Express da por bueno al salto inmediato SEA QUIEN SEA; con una lista, el
 *    salto inmediato tiene que estar dentro de ella (ver `ip-cliente.ts`).
 */
export type ConfigTrustProxy = false | readonly string[];

export type ResultadoTrustProxy =
  | { readonly ok: true; readonly valor: ConfigTrustProxy }
  | { readonly ok: false; readonly motivo: string };

// Los mensajes nombran la variable, NUNCA el valor recibido (cargarEnv no vuelca valores).
const MOTIVO_OBLIGATORIA_EN_PRODUCCION =
  'es obligatoria en produccion y debe listar los saltos de confianza (subredes del proxy); no puede faltar ni valer "false"';
const MOTIVO_FORMATO =
  'debe ser una lista separada por comas de nombres (loopback, linklocal, uniquelocal), IPs o subredes CIDR contenidas por entero en un rango privado (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, ::1/128, fc00::/7, fe80::/10); no se admite "true", un numero de saltos, una IP o subred publica, una subred mas ancha que su rango privado ni una IPv6 con IPv4 incrustada (::ffff:a.b.c.d)';

const NOMBRES_PREDEFINIDOS: ReadonlySet<string> = new Set(['loopback', 'linklocal', 'uniquelocal']);

const BITS_IPV4 = 32;
const BITS_IPV6 = 128;

type Familia = 'ipv4' | 'ipv6';

interface RangoPrivado {
  readonly familia: Familia;
  readonly prefijo: number;
  readonly lista: BlockList;
}

function rangoPrivado(familia: Familia, direccion: string, prefijo: number): RangoPrivado {
  const lista = new BlockList();
  lista.addSubnet(direccion, prefijo, familia);
  return { familia, prefijo, lista };
}

/**
 * Los mismos rangos que los tres nombres predefinidos de Express (loopback,
 * linklocal y uniquelocal). Un salto de confianza solo puede estar dentro de la
 * red privada del despliegue: confiar en una dirección pública, o en una
 * subred que la incluya, es `trust proxy: true` con otro nombre.
 */
const RANGOS_PRIVADOS: readonly RangoPrivado[] = [
  rangoPrivado('ipv4', '127.0.0.0', 8),
  rangoPrivado('ipv4', '10.0.0.0', 8),
  rangoPrivado('ipv4', '172.16.0.0', 12),
  rangoPrivado('ipv4', '192.168.0.0', 16),
  rangoPrivado('ipv4', '169.254.0.0', 16),
  rangoPrivado('ipv6', '::1', 128),
  rangoPrivado('ipv6', 'fc00::', 7),
  rangoPrivado('ipv6', 'fe80::', 10),
];

/**
 * Un elemento de la lista: un nombre de Express, o una IP o subred `dir/p`
 * contenida ENTERA en un rango privado `R/rp`, es decir, con `p >= rp` y
 * `dir` dentro de `R`. Mirar solo el prefijo no basta: dos `/1` juntos
 * (`0.0.0.0/1,128.0.0.0/1`) o `::ffff:0:0/96` confían en toda una familia.
 *
 * Una IPv6 con IPv4 incrustada (`::ffff:a.b.c.d`, `::a.b.c.d`) se rechaza: la
 * IPv4 de dentro se evaluaría contra los rangos IPv4 y Express (proxy-addr) ni
 * siquiera acepta la forma no mapeada. Los elementos IPv6 solo se comparan con
 * rangos IPv6, porque `BlockList` casa una IPv6 mapeada contra reglas IPv4.
 */
function esElementoValido(elemento: string): boolean {
  if (NOMBRES_PREDEFINIDOS.has(elemento)) return true;

  const [direccion = '', prefijo, ...sobrante] = elemento.split('/');
  const version = isIP(direccion);
  if (version === 0 || sobrante.length > 0) return false;
  if (version === 6 && direccion.includes('.')) return false;

  if (prefijo !== undefined && !/^\d{1,3}$/.test(prefijo)) return false;
  const maximo = version === 4 ? BITS_IPV4 : BITS_IPV6;
  const bits = prefijo === undefined ? maximo : Number(prefijo);
  if (bits > maximo) return false;

  const familia: Familia = version === 4 ? 'ipv4' : 'ipv6';
  return RANGOS_PRIVADOS.some(
    (rango) =>
      rango.familia === familia && bits >= rango.prefijo && rango.lista.check(direccion, familia),
  );
}

/**
 * Interpreta la variable `TRUST_PROXY`.
 *
 * En producción es obligatoria y no puede ser `false`: la topología de
 * producción SIEMPRE tiene proxy, y sin él todos los clientes compartirían la
 * IP del último salto (un único contador para toda la gente). Que falte es un
 * error de despliegue, no un valor por defecto razonable.
 */
export function interpretarTrustProxy(
  crudo: string | undefined,
  enProduccion: boolean,
): ResultadoTrustProxy {
  const texto = (crudo ?? '').trim();

  if (texto === '' || texto === 'false') {
    return enProduccion
      ? { ok: false, motivo: MOTIVO_OBLIGATORIA_EN_PRODUCCION }
      : { ok: true, valor: false };
  }

  const elementos = texto.split(',').map((elemento) => elemento.trim());
  if (!elementos.every(esElementoValido)) return { ok: false, motivo: MOTIVO_FORMATO };

  return { ok: true, valor: elementos };
}
