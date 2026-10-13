import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/eb-garamond/400.css';
import '@fontsource/eb-garamond/500.css';
import '@fontsource/eb-garamond/400-italic.css';
import '@fontsource/jost/300.css';
import '@fontsource/jost/400.css';
import '@fontsource/jost/500.css';
import { App } from './App';
import { observarCambiosDeTema } from './lib/tema';
import './estilos.css';

const raiz = document.getElementById('raiz');
if (raiz === null) {
  throw new Error('No existe el elemento #raiz en index.html');
}

observarCambiosDeTema();

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Registro del service worker: instalable desde ya, sin cache offline todavia.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}
