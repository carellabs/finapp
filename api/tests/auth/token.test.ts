import { describe, expect, it } from 'vitest';
import { generarToken, hashearToken } from '../../src/auth/token';

describe('generarToken', () => {
  it('genera tokens distintos en cada llamada', () => {
    expect(generarToken()).not.toBe(generarToken());
  });

  it('tiene suficiente entropía (32 bytes en base64url, sin relleno)', () => {
    const token = generarToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(token).not.toMatch(/[+/=]/); // base64url, no base64 estándar
  });
});

describe('hashearToken', () => {
  it('es determinista: el mismo token produce siempre el mismo hash', () => {
    const token = generarToken();
    expect(hashearToken(token)).toBe(hashearToken(token));
  });

  it('el hash nunca es igual al token original', () => {
    const token = generarToken();
    expect(hashearToken(token)).not.toBe(token);
  });

  it('tokens distintos producen hashes distintos', () => {
    expect(hashearToken(generarToken())).not.toBe(hashearToken(generarToken()));
  });
});
