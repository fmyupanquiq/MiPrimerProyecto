-- Cuota individual nula también en una apuesta Creada manual (Fase 10.6, decisión del usuario
-- 2026-10-06: "extender la regla a Creada manual"). Una apuesta de la casa tipo "Creada" puede
-- mostrar varias selecciones con una sola cuota total visible, sin cuota por selección; no se
-- inventa ni se distribuye artificialmente esa cuota (regla crítica de dominio).
--
-- Reemplaza los disparadores de 0036: la condición pasa de "solo si la apuesta es de un lote"
-- a "solo si la apuesta es de un lote, O es de tipo CREATED". Simple y Múltiple no cambian: siguen
-- exigiendo la cuota de cada selección fuera de un lote de importación.
CREATE OR REPLACE FUNCTION validate_bet_selection_odds() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_batch_id uuid;
  v_bet_type text;
BEGIN
  IF NEW.visible_odds IS NULL THEN
    SELECT b.batch_id, b.bet_type INTO v_batch_id, v_bet_type FROM bets b WHERE b.id = NEW.bet_id;
    IF v_batch_id IS NULL AND v_bet_type IS DISTINCT FROM 'CREATED' THEN
      RAISE EXCEPTION 'Solo las apuestas de un lote de importación o de tipo Creada pueden tener selecciones sin cuota'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'bet_selections_odds_required_outside_batch';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_bet_batch_odds() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.batch_id IS NULL
     AND NEW.bet_type IS DISTINCT FROM 'CREATED'
     AND EXISTS (
       SELECT 1 FROM bet_selections s WHERE s.bet_id = NEW.id AND s.visible_odds IS NULL
     ) THEN
    RAISE EXCEPTION 'Una apuesta con selecciones sin cuota debe pertenecer a un lote de importación o ser de tipo Creada'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bet_selections_odds_required_outside_batch';
  END IF;
  RETURN NEW;
END;
$$;
