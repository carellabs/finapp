-- Up Migration

-- Enums cerrados por el dominio (§2.4, §2.5). Las CATEGORIAS no van aqui:
-- son datos en tabla, referenciadas por id. Meterlas en un enum obligaria a
-- migrar para renombrar una y reintroduciria la referencia por nombre.
CREATE TYPE tipo_transaccion AS ENUM ('Ingreso', 'Gasto', 'Transferencia');
CREATE TYPE direccion_transferencia AS ENUM ('entrada', 'salida');
CREATE TYPE subtipo_transferencia AS ENUM ('pass_through', 'traspaso_ahorro');
CREATE TYPE necesidad_gasto AS ENUM ('Esencial', 'Flexible', 'Prescindible');
CREATE TYPE recurrencia_transaccion AS ENUM ('Recurrente', 'Puntual');
CREATE TYPE metodo_pago AS ENUM (
  'Tarjeta', 'Efectivo', 'Transferencia', 'Domiciliacion', 'Bizum', 'Otro'
);
CREATE TYPE estado_prestamo AS ENUM ('activo', 'devuelto', 'incobrable');
CREATE TYPE tipo_objetivo AS ENUM ('fondo_emergencia', 'secundario');

-- Un solo sitio donde se mantiene updated_at. Hacerlo desde la aplicacion
-- deja filas sin actualizar en cuanto alguien escribe por SQL directo.
CREATE FUNCTION establecer_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $funcion$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$funcion$;

-- Down Migration

DROP FUNCTION establecer_updated_at;
DROP TYPE tipo_objetivo;
DROP TYPE estado_prestamo;
DROP TYPE metodo_pago;
DROP TYPE recurrencia_transaccion;
DROP TYPE necesidad_gasto;
DROP TYPE subtipo_transferencia;
DROP TYPE direccion_transferencia;
DROP TYPE tipo_transaccion;
