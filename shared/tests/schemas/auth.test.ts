import { describe, expect, it } from 'vitest';
import { zLogin } from '../../src/schemas/auth';

describe('zLogin', () => {
  it('acepta usuario y contraseña no vacíos', () => {
    expect(zLogin.safeParse({ nombreUsuario: 'fabrizio', password: 'algo' }).success).toBe(true);
  });

  it('rechaza un nombre de usuario vacío', () => {
    expect(zLogin.safeParse({ nombreUsuario: '', password: 'algo' }).success).toBe(false);
  });

  it('rechaza una contraseña vacía', () => {
    expect(zLogin.safeParse({ nombreUsuario: 'fabrizio', password: '' }).success).toBe(false);
  });

  it('rechaza campos ausentes', () => {
    expect(zLogin.safeParse({}).success).toBe(false);
  });
});
