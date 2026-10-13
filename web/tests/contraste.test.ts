import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regresión: el handoff de identidad visual exige "contraste AA en texto
 * `tenue` sobre `superficie`" como criterio de aceptación, pero sus propios
 * hex originales daban 4.00-4.40 (insuficiente, hace falta 4.5). Se
 * ajustaron `tenue`/`oro`/`neutro`; este test evita que un futuro cambio de
 * paleta vuelva a romper el criterio en silencio.
 */

const AA_TEXTO_NORMAL = 4.5;

function luminanciaRelativa(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const canales = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * canales[0]! + 0.7152 * canales[1]! + 0.0722 * canales[2]!;
}

function ratioContraste(a: string, b: string): number {
  const l1 = luminanciaRelativa(a);
  const l2 = luminanciaRelativa(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Extrae `--color-<nombre>: #hex;` de un bloque de texto CSS. */
function extraerTokens(bloqueCss: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const coincidencia of bloqueCss.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    tokens[coincidencia[1]!] = coincidencia[2]!;
  }
  return tokens;
}

const CSS = readFileSync(join(import.meta.dirname, '../src/estilos.css'), 'utf8');

// El bloque `@theme` (antes de `@layer theme`) son los valores en modo claro;
// `[data-tema='oscuro']` los sobreescribe para el oscuro.
const INICIO_OSCURO = CSS.indexOf("[data-tema='oscuro']");
const TOKENS_CLARO = extraerTokens(CSS.slice(0, INICIO_OSCURO));
const TOKENS_OSCURO = { ...TOKENS_CLARO, ...extraerTokens(CSS.slice(INICIO_OSCURO)) };

const TEXTOS = ['tinta', 'tenue', 'verde', 'oro', 'burdeos', 'neutro', 'tabaco'];
const FONDOS = ['papel', 'superficie'];

describe.each([
  ['claro', TOKENS_CLARO],
  ['oscuro', TOKENS_OSCURO],
])('contraste AA en modo %s', (_nombre, tokens) => {
  it.each(TEXTOS.flatMap((texto) => FONDOS.map((fondo) => [texto, fondo] as const)))(
    '%s sobre %s cumple AA (>= 4.5:1)',
    (texto, fondo) => {
      const ratio = ratioContraste(tokens[texto]!, tokens[fondo]!);
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL);
    },
  );
});
