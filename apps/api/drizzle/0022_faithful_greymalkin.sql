-- Se añade sin `NOT NULL` primero y se rellena desde `updated_at` (revisión final previa a
-- integrar: aplicar `DEFAULT now()` directamente habría marcado TODAS las apuestas ya
-- existentes con el instante de la migración —no con su propio historial—, y cualquier
-- checkpoint MATCHED anterior a ese instante habría aparecido como falso hallazgo de
-- CHECKPOINT_INVALIDATION nada más desplegar. `updated_at` es la mejor aproximación
-- disponible al último cambio real de cada apuesta ya existente; en adelante, el disparador
-- de 0023 mantiene la columna con precisión.
ALTER TABLE "bets" ADD COLUMN "financial_fields_updated_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "bets" SET "financial_fields_updated_at" = "updated_at";
--> statement-breakpoint
ALTER TABLE "bets" ALTER COLUMN "financial_fields_updated_at" SET DEFAULT now();
--> statement-breakpoint
ALTER TABLE "bets" ALTER COLUMN "financial_fields_updated_at" SET NOT NULL;