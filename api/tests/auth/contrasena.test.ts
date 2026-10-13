import { describe, expect, it } from 'vitest';
import { hashearContrasena, verificarContrasena } from '../../src/auth/contrasena';

describe('hashearContrasena / verificarContrasena', () => {
  it('un hash verifica correctamente contra su propia contraseña', async () => {
    const hash = await hashearContrasena('una-contrasena-de-prueba');
    expect(await verificarContrasena(hash, 'una-contrasena-de-prueba')).toBe(true);
  });

  it('rechaza una contraseña incorrecta', async () => {
    const hash = await hashearContrasena('una-contrasena-de-prueba');
    expect(await verificarContrasena(hash, 'otra-cosa')).toBe(false);
  });

  it('el hash nunca contiene la contraseña en claro', async () => {
    const contrasena = 'super-secreta-123';
    const hash = await hashearContrasena(contrasena);
    expect(hash).not.toContain(contrasena);
  });

  it('el hash usa el prefijo $argon2id$: nunca un algoritmo más débil', async () => {
    const hash = await hashearContrasena('cualquier-cosa');
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it('la misma contraseña produce hashes distintos cada vez (salt aleatoria)', async () => {
    const hash1 = await hashearContrasena('repetida');
    const hash2 = await hashearContrasena('repetida');
    expect(hash1).not.toBe(hash2);
  });
});
