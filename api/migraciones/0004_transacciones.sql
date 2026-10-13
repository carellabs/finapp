-- Up Migration

CREATE TABLE transacciones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- `fecha` es forense (cuando ocurrio). `mes_cobertura` es contable (a que
  -- ciclo se imputa). La nomina del 30 de junio cubre julio. TODA agregacion
  -- usa mes_cobertura. `date` sin zona: timestamptz desplazaria dias.
  fecha         date NOT NULL,
  mes_cobertura char(7) NOT NULL
                CHECK (mes_cobertura ~ '^\d{4}-(0[1-9]|1[0-2])$'),

  tipo          tipo_transaccion NOT NULL,
  categoria_id  uuid NOT NULL REFERENCES categorias (id) ON DELETE RESTRICT,

  -- El signo lo determina `tipo`; el importe es siempre positivo.
  monto         numeric(12, 2) NOT NULL CHECK (monto > 0),

  direccion     direccion_transferencia,
  subtipo       subtipo_transferencia,
  necesidad     necesidad_gasto,
  recurrencia   recurrencia_transaccion,
  metodo        metodo_pago NOT NULL,
  descripcion   text,

  prestamo_id   uuid REFERENCES prestamos (id) ON DELETE RESTRICT,
  deuda_id      uuid REFERENCES deudas (id) ON DELETE RESTRICT,

  -- Clave natural de la importacion (fase 8): hace el script idempotente.
  origen_id     text UNIQUE,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- La igualdad fuerza las DOS direcciones: una transferencia exige direccion
  -- y subtipo, y ningun otro tipo puede llevarlos.
  CONSTRAINT transferencia_exige_direccion
    CHECK ((tipo = 'Transferencia') = (direccion IS NOT NULL)),
  CONSTRAINT transferencia_exige_subtipo
    CHECK ((tipo = 'Transferencia') = (subtipo IS NOT NULL)),
  CONSTRAINT solo_el_gasto_tiene_necesidad
    CHECK ((tipo = 'Gasto') = (necesidad IS NOT NULL)),
  CONSTRAINT ingreso_y_gasto_exigen_recurrencia
    CHECK ((tipo IN ('Ingreso', 'Gasto')) = (recurrencia IS NOT NULL)),
  CONSTRAINT prestamo_solo_en_transferencias
    CHECK (prestamo_id IS NULL OR tipo = 'Transferencia'),
  CONSTRAINT deuda_solo_en_gastos
    CHECK (deuda_id IS NULL OR tipo = 'Gasto')
);

CREATE TRIGGER transacciones_updated_at
  BEFORE UPDATE ON transacciones
  FOR EACH ROW EXECUTE FUNCTION establecer_updated_at();

-- Dashboard del mes.
CREATE INDEX transacciones_mes_tipo ON transacciones (mes_cobertura, tipo);
-- Drill-down y agregados por categoria.
CREATE INDEX transacciones_categoria ON transacciones (categoria_id);
-- El calculo del CSM barre TODO el historico filtrando por los dos ejes.
-- Parcial sobre gastos: el CSM no mira ingresos ni transferencias.
CREATE INDEX transacciones_csm
  ON transacciones (mes_cobertura, necesidad, recurrencia)
  WHERE tipo = 'Gasto';
-- Listado cronologico y deteccion de suscripciones.
CREATE INDEX transacciones_fecha ON transacciones (fecha);
-- Pendiente de prestamos.
CREATE INDEX transacciones_prestamo ON transacciones (prestamo_id)
  WHERE prestamo_id IS NOT NULL;

-- Down Migration

DROP TABLE transacciones;
