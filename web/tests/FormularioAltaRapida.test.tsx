import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fechaISO, mesCobertura } from '@finapp/shared';
import { FormularioAltaRapida } from '../src/features/alta-rapida/FormularioAltaRapida';
import type { FormularioTransaccion } from '../src/features/alta-rapida/esquema-formulario';
import type { CategoriaApi } from '../src/features/categorias/usar-categorias';

const ID_SUPERMERCADO = '11111111-1111-4111-8111-111111111111';
const ID_PASS_THROUGH = '22222222-2222-4222-8222-222222222222';

const CATEGORIAS: readonly CategoriaApi[] = [
  {
    id: ID_SUPERMERCADO,
    nombre: 'Alimentación - Supermercado',
    esPassThrough: false,
    esDeuda: false,
    activa: true,
  },
  {
    id: ID_PASS_THROUGH,
    nombre: 'Transferencia - Pass-through',
    esPassThrough: true,
    esDeuda: false,
    activa: true,
  },
];

const HOY = fechaISO('2026-08-05');

const VALORES_INICIALES: FormularioTransaccion = {
  tipo: 'Gasto',
  fecha: HOY,
  mesCobertura: mesCobertura('2026-08'),
  categoriaId: '',
  montoEuros: 0,
  metodo: 'Tarjeta',
  necesidad: 'Flexible',
  recurrencia: 'Puntual',
};

function renderizar(opciones: { categorias?: readonly CategoriaApi[] } = {}) {
  const onEnviar = vi.fn();
  render(
    <FormularioAltaRapida
      categorias={opciones.categorias ?? CATEGORIAS}
      valoresIniciales={VALORES_INICIALES}
      enviando={false}
      hayError={false}
      hoy={HOY}
      usuarioId="33333333-3333-4333-8333-333333333333"
      onEnviar={onEnviar}
      onDescartarError={vi.fn()}
    />,
  );
  return { onEnviar };
}

/** Recorre tipo → importe → dirección, dejando el flujo en el paso de resumen. */
function completarTransferencia(): void {
  fireEvent.click(screen.getByRole('button', { name: /Transferencia/ }));
  fireEvent.click(screen.getByRole('button', { name: '4' }));
  fireEvent.click(screen.getByRole('button', { name: '2' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  fireEvent.click(screen.getByRole('button', { name: /Entra/ }));
}

describe('FormularioAltaRapida', () => {
  // Regresión: el wizard salta el paso de categoría en Transferencia, pero
  // `categoriaId` sigue siendo obligatorio en el esquema (`camposBase`). Si
  // nadie asigna la categoría pass-through, `handleSubmit` bloquea el envío
  // y "Guardar" no hace absolutamente nada.
  it('una Transferencia se guarda con la categoría pass-through, sin pedirla', async () => {
    const { onEnviar } = renderizar();

    completarTransferencia();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => {
      expect(onEnviar).toHaveBeenCalledTimes(1);
    });
    expect(onEnviar.mock.calls[0]?.[0]).toMatchObject({
      tipo: 'Transferencia',
      categoriaId: ID_PASS_THROUGH,
      direccion: 'entrada',
      montoEuros: 42,
    });
  });

  // Regresión: al reescribir el formulario se perdió `formState.errors`, así
  // que un fallo de validación dejaba el botón "Guardar" mudo. Un formulario
  // que no se envía y no dice por qué es un callejón sin salida.
  it('si la validación falla, lo dice en pantalla en vez de quedarse mudo', async () => {
    // Sin categoría pass-through no hay `categoriaId` que asignar: el esquema
    // rechaza el envío y la persona tiene que enterarse.
    const { onEnviar } = renderizar({ categorias: [CATEGORIAS[0]!] });

    completarTransferencia();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    // El mensaje habla el idioma de la persona, no el del esquema: nada de
    // "Invalid uuid" ni el nombre crudo del campo.
    expect(screen.getByRole('alert')).toHaveTextContent(/Categoría/);
    expect(screen.getByRole('alert')).not.toHaveTextContent(/uuid/i);
    expect(onEnviar).not.toHaveBeenCalled();
  });

  // Issue #29: la API rechaza un importe por encima de numeric(12, 2). La persona lo ve aquí, con su
  // motivo, y no como un "No hemos podido guardar" genérico tras un 422.
  describe('importe por encima del tope de la API', () => {
    function teclear(texto: string): void {
      fireEvent.click(screen.getByRole('button', { name: /Transferencia/ }));
      for (const tecla of texto) {
        fireEvent.click(screen.getByRole('button', { name: tecla }));
      }
      fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
      fireEvent.click(screen.getByRole('button', { name: /Entra/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    }

    it('10.000.000.000,00 € avisa en el paso del importe, no deja continuar y no se envía', () => {
      const { onEnviar } = renderizar();

      fireEvent.click(screen.getByRole('button', { name: /Transferencia/ }));
      for (const tecla of '10000000000') {
        fireEvent.click(screen.getByRole('button', { name: tecla }));
      }

      // jest-dom normaliza el espacio duro de es-ES del texto de la página, no el del esperado.
      expect(screen.getByRole('alert')).toHaveTextContent(
        /El importe no puede superar 9\.999\.999\.999,99\s€/,
      );
      expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
      expect(onEnviar).not.toHaveBeenCalled();
    });

    it('9.999.999.999,99 € (el tope exacto) sí se envía (control positivo)', async () => {
      const { onEnviar } = renderizar();

      teclear('9999999999,99');

      await waitFor(() => {
        expect(onEnviar).toHaveBeenCalledTimes(1);
      });
      expect(onEnviar.mock.calls[0]?.[0]).toMatchObject({ montoEuros: 9999999999.99 });
    });
  });
});
