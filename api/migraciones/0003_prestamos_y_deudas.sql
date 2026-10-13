-- Up Migration

-- Prestamos a terceros. `devuelto` y `pendiente` NO se almacenan: se derivan
-- de las transacciones con este prestamo_id. Un saldo duplicado es un saldo
-- que acabara divergiendo.
CREATE TABLE prestamos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona             text NOT NULL,
  concepto            text,
  adeudado            numeric(12, 2) NOT NULL CHECK (adeudado > 0),
  devolucion_estimada date,
  estado              estado_prestamo NOT NULL DEFAULT 'activo',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER prestamos_updated_at
  BEFORE UPDATE ON prestamos
  FOR EACH ROW EXECUTE FUNCTION establecer_updated_at();

-- Deuda propia. `saldo_inicial` es el saldo A FECHA DE INICIO DEL REGISTRO en
-- la app, no el importe original del prestamo.
CREATE TABLE deudas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concepto      text NOT NULL,
  saldo_inicial numeric(12, 2) NOT NULL CHECK (saldo_inicial >= 0),
  fecha_inicio  date NOT NULL,
  pago_mensual  numeric(12, 2) NOT NULL CHECK (pago_mensual > 0),
  activa        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER deudas_updated_at
  BEFORE UPDATE ON deudas
  FOR EACH ROW EXECUTE FUNCTION establecer_updated_at();

-- Down Migration

DROP TABLE deudas;
DROP TABLE prestamos;
