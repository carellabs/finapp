import { fechaISO, type FechaISO } from '@finapp/shared';

/**
 * Los últimos `cantidad` días (incluido `hoy`, más reciente primero) — para
 * las chips rápidas de fecha del wizard de alta (handoff §2.5: "Hoy" +
 * 3 sugerencias). No es un cálculo financiero, solo qué fechas ofrecer.
 */
export function ultimosDias(hoy: FechaISO, cantidad: number): FechaISO[] {
  const base = new Date(`${hoy}T00:00:00Z`);
  return Array.from({ length: cantidad }, (_, i) => {
    const dia = new Date(base);
    dia.setUTCDate(dia.getUTCDate() - i);
    return fechaISO(dia.toISOString().slice(0, 10));
  });
}

/** `fecha` + `meses` meses — para sugerir fechas límite de objetivos (+3/+6/+12 meses). */
export function sumarMeses(fecha: FechaISO, meses: number): FechaISO {
  const base = new Date(`${fecha}T00:00:00Z`);
  base.setUTCMonth(base.getUTCMonth() + meses);
  return fechaISO(base.toISOString().slice(0, 10));
}
