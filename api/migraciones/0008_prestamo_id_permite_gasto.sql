-- Up Migration

-- El write-off de un prestamo incobrable (§2.7, §10) genera un GASTO real
-- vinculado al prestamo, no una Transferencia. La migracion 0004 solo
-- permitia prestamo_id en Transferencia porque en ese momento el unico caso
-- contemplado era el prestamo/devolucion normal. Se amplia para admitir
-- tambien Gasto, sin abrirlo a Ingreso.
ALTER TABLE transacciones DROP CONSTRAINT prestamo_solo_en_transferencias;

ALTER TABLE transacciones ADD CONSTRAINT prestamo_solo_en_transferencias_o_gasto
  CHECK (prestamo_id IS NULL OR tipo IN ('Transferencia', 'Gasto'));

-- Down Migration

ALTER TABLE transacciones DROP CONSTRAINT prestamo_solo_en_transferencias_o_gasto;

ALTER TABLE transacciones ADD CONSTRAINT prestamo_solo_en_transferencias
  CHECK (prestamo_id IS NULL OR tipo = 'Transferencia');
