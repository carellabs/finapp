import { z } from 'zod';

export const zLogin = z.object({
  nombreUsuario: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

export type LoginEntrada = z.infer<typeof zLogin>;
