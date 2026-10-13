-- Up Migration

CREATE TABLE objetivos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo             tipo_objetivo NOT NULL,
  nombre           text NOT NULL,
  -- El fondo de emergencia NO lleva importe: se calcula (CSM x meses) y es
  -- movil. Guardarlo seria congelar la cifra, que es justo lo prohibido.
  importe_objetivo numeric(12, 2) CHECK (importe_objetivo > 0),
  fecha_limite     date,
  activo           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fondo_no_lleva_importe_fijo
    CHECK ((tipo = 'fondo_emergencia') = (importe_objetivo IS NULL))
);

CREATE TRIGGER objetivos_updated_at
  BEFORE UPDATE ON objetivos
  FOR EACH ROW EXECUTE FUNCTION establecer_updated_at();

-- Un unico fondo de emergencia activo.
CREATE UNIQUE INDEX objetivos_unico_fondo_activo
  ON objetivos ((true)) WHERE tipo = 'fondo_emergencia' AND activo;

-- Histórico del objetivo calculado por mes (regla §3.4: el objetivo es movil).
-- `desglose` es OBLIGATORIO: sin el CSM por categoria no se puede responder
-- "que categoria empujo el objetivo al alza", que es el aviso critico.
CREATE TABLE objetivo_historico (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mes_cobertura    char(7) NOT NULL UNIQUE
                   CHECK (mes_cobertura ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  csm              numeric(12, 2) NOT NULL CHECK (csm >= 0),
  objetivo         numeric(12, 2) NOT NULL CHECK (objetivo >= 0),
  margen_seguridad numeric(5, 4) NOT NULL CHECK (margen_seguridad >= 0),
  meses_objetivo   integer NOT NULL CHECK (meses_objetivo > 0),
  desglose         jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT desglose_es_objeto CHECK (jsonb_typeof(desglose) = 'object')
);

-- Serie temporal del ahorro DECLARADO por el usuario (decision B5). La app no
-- ve las cuentas bancarias: no lo infiere, lo compara y senala divergencias.
CREATE TABLE saldo_ahorro_declarado (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha      date NOT NULL,
  saldo      numeric(12, 2) NOT NULL CHECK (saldo >= 0),
  nota       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX saldo_ahorro_declarado_fecha ON saldo_ahorro_declarado (fecha DESC);

CREATE TABLE configuracion (
  clave      text PRIMARY KEY,
  valor      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER configuracion_updated_at
  BEFORE UPDATE ON configuracion
  FOR EACH ROW EXECUTE FUNCTION establecer_updated_at();

-- Valores por defecto de §3. El margen de seguridad NUNCA es 0 por defecto.
INSERT INTO configuracion (clave, valor) VALUES
  ('margen_seguridad',           '0.15'),
  ('meses_objetivo',             '6'),
  ('n_meses_csm',                '3'),
  ('porcentaje_ahorro_objetivo', '0.22'),
  ('umbral_divergencia_pct',     '0.05'),
  ('umbral_divergencia_min',     '50.00');

-- Down Migration

DROP TABLE configuracion;
DROP TABLE saldo_ahorro_declarado;
DROP TABLE objetivo_historico;
DROP TABLE objetivos;
