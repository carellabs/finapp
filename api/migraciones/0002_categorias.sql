-- Up Migration

CREATE TABLE categorias (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          text NOT NULL UNIQUE,
  -- Banderas en lugar de comparar el nombre: renombrar una categoria no puede
  -- alterar ni un calculo. Este es el bug original de la hoja de calculo.
  es_pass_through boolean NOT NULL DEFAULT false,
  es_deuda        boolean NOT NULL DEFAULT false,
  activa          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER categorias_updated_at
  BEFORE UPDATE ON categorias
  FOR EACH ROW EXECUTE FUNCTION establecer_updated_at();

-- Como mucho una categoria de cada clase especial.
CREATE UNIQUE INDEX categorias_unica_pass_through
  ON categorias ((true)) WHERE es_pass_through;
CREATE UNIQUE INDEX categorias_unica_deuda
  ON categorias ((true)) WHERE es_deuda;

-- Seed: configuracion del sistema (§2.8), no datos inventados.
INSERT INTO categorias (nombre, es_pass_through, es_deuda) VALUES
  ('Nómina',                             false, false),
  ('Vivienda - Alquiler / Hipoteca',     false, false),
  ('Suministros - Gas / Agua',           false, false),
  ('Suministros - Luz',                  false, false),
  ('Alimentación - Supermercado',        false, false),
  ('Alimentación - Restaurantes / Delivery', false, false),
  ('Transporte',                         false, false),
  ('Salud',                              false, false),
  ('Deuda',                              false, true),
  ('Telecomunicaciones',                 false, false),
  ('Suscripciones - Ocio / Software',    false, false),
  ('Ropa',                               false, false),
  ('Viajes',                             false, false),
  ('Mascota',                            false, false),
  ('Transferencia - Pass-through',       true,  false),
  ('Otros',                              false, false);

-- Down Migration

DROP TABLE categorias;
