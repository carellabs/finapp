-- Up Migration

-- Versionado por mes: comparar octubre contra el presupuesto que se fijo en
-- marzo es reescribir la historia. Sin fila = sin presupuesto = sin alerta;
-- NO se hereda del mes anterior (decision B4).
CREATE TABLE presupuestos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id  uuid NOT NULL REFERENCES categorias (id) ON DELETE RESTRICT,
  mes_cobertura char(7) NOT NULL
                CHECK (mes_cobertura ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  monto         numeric(12, 2) NOT NULL CHECK (monto > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT presupuesto_unico_por_categoria_y_mes
    UNIQUE (categoria_id, mes_cobertura)
);

CREATE TRIGGER presupuestos_updated_at
  BEFORE UPDATE ON presupuestos
  FOR EACH ROW EXECUTE FUNCTION establecer_updated_at();

CREATE INDEX presupuestos_mes ON presupuestos (mes_cobertura);

-- Down Migration

DROP TABLE presupuestos;
