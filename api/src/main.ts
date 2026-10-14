import { cargarEnv } from './config/env';
import { arrancar } from './servidor';

// Solo cablea el proceso: toda la lógica de arranque y apagado vive en `servidor.ts`,
// donde los tests la alcanzan.
const { apagar } = arrancar(cargarEnv());

const salir = (): void => {
  void apagar().then(() => process.exit(0));
};

process.on('SIGTERM', salir);
process.on('SIGINT', salir);
