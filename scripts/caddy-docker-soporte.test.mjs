/**
 * Test del soporte de los tests de Docker (scripts/soporte/caddy-docker.mjs): si quien lanza los
 * tests los interrumpe (Ctrl+C = SIGINT, o un `kill` = SIGTERM), los contenedores y la red de
 * prueba se borran igualmente. `process.on('exit')` solo no basta: Node NO lo ejecuta cuando el
 * proceso muere por una senal con un manejador ausente.
 *
 * No se manda una senal de verdad (en Windows `kill` mata sin ejecutar manejadores): se comprueba
 * que los manejadores estan registrados y que, llamados, limpian y piden salir con el codigo
 * convencional (128 + numero de la senal).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { docker, dockerDisponible, dockerOk, EntornoCaddy } from './soporte/caddy-docker.mjs';

const existeLaRed = (nombre) =>
  dockerOk(['network', 'ls', '--filter', `name=^${nombre}$`, '--format', '{{.Name}}']) === nombre;

describe('EntornoCaddy: limpieza al interrumpir el proceso', () => {
  it('SIGINT y SIGTERM tienen manejador, que borra todo y sale con 130 y 143; soltar() los quita', () => {
    assert.ok(dockerDisponible(), 'Docker no responde: arranca Docker Desktop');
    const salidas = [];
    const entorno = new EntornoCaddy({ salir: (codigo) => salidas.push(codigo) });
    try {
      assert.ok(process.listeners('SIGINT').includes(entorno.alSIGINT), 'SIGINT sin manejador');
      assert.ok(process.listeners('SIGTERM').includes(entorno.alSIGTERM), 'SIGTERM sin manejador');

      for (const [manejador, codigo] of [
        [entorno.alSIGINT, 130],
        [entorno.alSIGTERM, 143],
      ]) {
        dockerOk(['network', 'create', entorno.red]);
        // Control positivo: la red esta de verdad antes de la senal.
        assert.ok(existeLaRed(entorno.red), 'la red de prueba no se ha creado');

        manejador();

        assert.ok(!existeLaRed(entorno.red), `la red sigue ahi tras la senal (${codigo})`);
        assert.equal(salidas.at(-1), codigo);
      }
      assert.deepEqual(salidas, [130, 143]);
    } finally {
      entorno.soltar();
      entorno.limpiar();
      docker(['network', 'rm', entorno.red], { stdio: 'ignore' });
    }

    assert.ok(!process.listeners('SIGINT').includes(entorno.alSIGINT), 'SIGINT sigue enganchado');
    assert.ok(
      !process.listeners('SIGTERM').includes(entorno.alSIGTERM),
      'SIGTERM sigue enganchado',
    );
  });
});
