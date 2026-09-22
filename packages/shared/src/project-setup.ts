import { z } from 'zod';
import { houseNameSchema } from './house.js';
import { moneyInputSchema } from './money.js';

/**
 * Configuración inicial del proyecto (§5, D1): crea la Etapa 1, fija su unidad, da de alta
 * las casas y registra la banca inicial distribuida entre ellas. Un proyecto de la Fase 2
 * (sin etapa ni casas) usa este mismo flujo para completarse; hasta entonces no admite
 * movimientos financieros.
 */
export const projectSetupSchema = z.object({
  /** Unidad de stake de la Etapa 1 (§12): `monto teórico = stake × unidad`. */
  unitStake: moneyInputSchema({ positive: true }),
  houses: z
    .array(
      z.object({
        name: houseNameSchema,
        /** Puede ser 0: una casa puede arrancar vacía y recibir fondos después (§15). */
        initialAmount: moneyInputSchema(),
      }),
    )
    .min(1, 'Añade al menos una casa de apuestas.')
    .max(50)
    .refine(
      (houses) => {
        const names = houses.map((house) => house.name.trim().toLowerCase());
        return new Set(names).size === names.length;
      },
      { message: 'No repitas el nombre de una casa.' },
    ),
});
export type ProjectSetupInput = z.infer<typeof projectSetupSchema>;
