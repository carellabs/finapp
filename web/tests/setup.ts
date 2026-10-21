import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// `findBy*` y `waitFor` esperan 1 s por defecto: con la maquina saturada un render de jsdom tarda
// mas (PanelTransaccionesCategoria no encontro el boton «Esencial» a 1,5-3,2 s con 12 y 36
// procesos de CPU en bucle; libre, aparece en decenas de ms). 5 s solo alarga la espera de lo
// que de verdad falla: lo que existe se encuentra en cuanto aparece. No subirlo sin medir.
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => {
  cleanup();
});
