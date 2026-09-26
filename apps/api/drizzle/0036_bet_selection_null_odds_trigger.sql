-- Cuota nula solo en apuestas de un lote de importación (Fase 9.1.2c, §113.5, D-X15, ADR 0020).
--
-- `bet_selections.visible_odds` admite nulo (0035) para las selecciones de un historial importado, que
-- no conserva la cuota individual: la cuota de la apuesta (`bets.visible_total_odds`, obligatoria) es
-- la autoridad. Un `CHECK` no puede consultar otra tabla, así que la regla la garantizan estos dos
-- disparadores (defensa en profundidad frente a escrituras fuera de la aplicación):
--
-- 1. Una selección sin cuota solo puede pertenecer a una apuesta con `batch_id`.
CREATE FUNCTION validate_bet_selection_odds() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.visible_odds IS NULL
     AND (SELECT b.batch_id FROM bets b WHERE b.id = NEW.bet_id) IS NULL THEN
    RAISE EXCEPTION 'Solo las apuestas de un lote de importación pueden tener selecciones sin cuota'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bet_selections_odds_required_outside_batch';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER bet_selections_validate_odds BEFORE INSERT OR UPDATE OF visible_odds, bet_id
  ON bet_selections
  FOR EACH ROW EXECUTE FUNCTION validate_bet_selection_odds();
--> statement-breakpoint
-- 2. Una apuesta no puede quedar sin lote mientras alguna de sus selecciones no tenga cuota.
CREATE FUNCTION validate_bet_batch_odds() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.batch_id IS NULL
     AND EXISTS (
       SELECT 1 FROM bet_selections s WHERE s.bet_id = NEW.id AND s.visible_odds IS NULL
     ) THEN
    RAISE EXCEPTION 'Una apuesta con selecciones sin cuota debe pertenecer a un lote de importación'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bet_selections_odds_required_outside_batch';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER bets_validate_batch_odds BEFORE UPDATE OF batch_id ON bets
  FOR EACH ROW EXECUTE FUNCTION validate_bet_batch_odds();
