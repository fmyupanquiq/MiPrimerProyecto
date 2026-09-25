-- Correcciones financieras de apuestas (Fase 8.5, §112, ADR 0019): integridad garantizada por la
-- base de datos.
--
-- 1. `amount_confirmed` (0030) nace en `false` y solo significa que un ticket, la casa o una persona
--    confirmó el monto (§76, §112.2): nunca que LetFer congeló su propio cálculo. Hasta ahora
--    `official_amount` se llenaba también al liquidar con el monto calculado, así que en una apuesta
--    ya liquidada no se puede saber de dónde venía: se trata como NO confirmada (conservador; no
--    había datos reales). Solo una apuesta pendiente con monto oficial lo tiene por indicación
--    directa de una persona o de un ticket, y queda confirmada.
UPDATE bets SET amount_confirmed = true WHERE official_amount IS NOT NULL AND status = 'PENDING';
--> statement-breakpoint
-- 2. `bet_corrections` es un histórico de solo inserción (§112.1): una corrección ya aplicada no
--    se edita ni se borra. Reutiliza `prevent_modification` (0000_base_functions.sql), igual que
--    `ticket_analyses` (0025) y `maintenance_runs` (0029).
CREATE TRIGGER bet_corrections_no_modification BEFORE UPDATE OR DELETE ON bet_corrections
  FOR EACH ROW EXECUTE FUNCTION prevent_modification();
--> statement-breakpoint
CREATE TRIGGER bet_corrections_no_truncate BEFORE TRUNCATE ON bet_corrections
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_modification();
--> statement-breakpoint
-- 3. Una reversión (§112.1, D-A1, D-A2) solo es válida si anula exactamente una fila vigente del
--    ledger: mismo proyecto, casa, monto, etapa, operación y fecha efectiva, con dirección opuesta.
--    No se revierte una reversión ni una transferencia (su efecto es un par origen/destino que
--    esta versión no revierte). El índice único parcial `financial_movements_one_reversal_per_row`
--    impide anular dos veces la misma fila; este disparador es la defensa en profundidad frente a
--    escrituras fuera de la aplicación.
CREATE FUNCTION validate_financial_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  original financial_movements%ROWTYPE;
BEGIN
  -- Sin fila de referencia (o sin ser reversión) decide el CHECK financial_movements_reversal_shape.
  IF NEW.type <> 'REVERSAL' OR NEW.reverses_movement_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO original FROM financial_movements WHERE id = NEW.reverses_movement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La fila que se intenta revertir no existe'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'financial_movements_reversal_match';
  END IF;
  IF original.type IN ('REVERSAL', 'TRANSFER') THEN
    RAISE EXCEPTION 'No se puede revertir una reversión ni una transferencia'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'financial_movements_reversal_match';
  END IF;
  IF original.project_id <> NEW.project_id
     OR original.house_id IS DISTINCT FROM NEW.house_id
     OR original.amount <> NEW.amount
     OR original.stage_id <> NEW.stage_id
     OR original.operation_id <> NEW.operation_id
     OR original.occurred_at <> NEW.occurred_at
     OR original.direction IS NOT DISTINCT FROM NEW.direction THEN
    RAISE EXCEPTION 'La reversión debe coincidir con la fila original y tener dirección opuesta'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'financial_movements_reversal_match';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER financial_movements_validate_reversal BEFORE INSERT ON financial_movements
  FOR EACH ROW EXECUTE FUNCTION validate_financial_reversal();
