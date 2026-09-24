-- M1 (revisión de arquitectura previa a integrar la Fase 5.5, §109.1.3): distingue un cambio con
-- efecto financiero real de una simple corrección administrativa (motivo, hora conocida), para
-- que la verificación de integridad (CHECKPOINT_INVALIDATION) no dé falsos positivos cada vez
-- que alguien edita el motivo o mueve de etapa una apuesta ya liquidada (§107.9).
--
-- Campos vigilados: casa, etapa, stake, monto oficial, estado y borrado lógico —todos entran en
-- el cálculo del comprometido de una casa (computeHouseBalances) o en el ledger al liquidar. La
-- fecha de colocación solo cuenta cuando la apuesta sigue PENDING: corregirla en una ya liquidada
-- no mueve el `occurred_at` ya fijado en el ledger (inmutable, D2), así que no es relevante ahí.
CREATE FUNCTION bump_bet_financial_timestamp() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.house_id IS DISTINCT FROM OLD.house_id
     OR NEW.stage_id IS DISTINCT FROM OLD.stage_id
     OR NEW.stake IS DISTINCT FROM OLD.stake
     OR NEW.official_amount IS DISTINCT FROM OLD.official_amount
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
     OR (NEW.placed_at IS DISTINCT FROM OLD.placed_at AND NEW.status = 'PENDING') THEN
    NEW.financial_fields_updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER bets_bump_financial_timestamp BEFORE UPDATE ON bets
  FOR EACH ROW EXECUTE FUNCTION bump_bet_financial_timestamp();
