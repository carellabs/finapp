-- Up Migration

-- Autenticacion desde el primer despliegue (§8.1), aunque el usuario sea uno
-- solo. Aplazarla obliga a rehacer sesiones, rutas y validacion.
CREATE TABLE usuarios (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_usuario   text NOT NULL UNIQUE,
  -- Argon2id. Nunca la contrasena, nunca un hash rapido tipo SHA.
  password_hash    text NOT NULL,
  intentos_fallidos integer NOT NULL DEFAULT 0 CHECK (intentos_fallidos >= 0),
  -- El bloqueo vive en la BD para que reiniciar el proceso no lo borre.
  bloqueado_hasta  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER usuarios_updated_at
  BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION establecer_updated_at();

-- Sesiones en servidor: revocables al instante. Se guarda el HASH del token,
-- nunca el token: quien lea la tabla no puede suplantar una sesion.
CREATE TABLE sesiones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expira_en  timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sesiones_usuario ON sesiones (usuario_id);
CREATE INDEX sesiones_expiracion ON sesiones (expira_en);

-- Down Migration

DROP TABLE sesiones;
DROP TABLE usuarios;
