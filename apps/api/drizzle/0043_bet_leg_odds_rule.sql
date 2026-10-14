-- Una Múltiple puede contener un leg creado (Bet Builder / Same Game Parlay) — §114.
--
-- Modelo: LEG = `event_group`; condiciones internas = filas del grupo ordenadas por `position`.
-- La cuota del LEG se guarda UNA vez, en la fila `position = 0`; las condiciones internas
-- (`position > 0`) de un leg creado no tienen cuota propia (nula). Nunca se copia ni se reparte.
--
-- Esta migración SOLO RELAJA la regla de 0041 (no endurece nada sobre datos existentes):
--   Antes:  cuota nula únicamente en un lote de importación o en una apuesta CREATED.
--   Ahora:  además, en una MULTIPLE ordinaria, en las filas `position > 0`, siempre que el leg
--           tenga cuota en su fila `position = 0` (comprobado al confirmar la transacción).
-- Toda fila y apuesta que era válida antes sigue siéndolo; no se reescribe ninguna.
--
-- 1. El disparador por fila (BEFORE) acepta la cuota nula de `position > 0` en una MULTIPLE. No puede
--    comprobar que existe la fila hermana `position = 0` (en un INSERT de varias filas las hermanas
--    aún no son visibles), así que eso lo verifica el disparador diferido de más abajo.
-- ROLLBACK (migración nueva, nunca editar esta): restaurar el cuerpo de las dos funciones de 0041 y
-- ejecutar `DROP TRIGGER bet_selections_check_leg_odds ON bet_selections; DROP TRIGGER
-- bets_check_leg_odds ON bets; DROP FUNCTION check_bet_leg_odds();` — solo es seguro mientras no
-- exista una MULTIPLE ordinaria con filas internas sin cuota (consulta de control:
-- `SELECT count(*) FROM bet_selections s JOIN bets b ON b.id = s.bet_id WHERE s.visible_odds IS NULL
-- AND b.batch_id IS NULL AND b.bet_type = 'MULTIPLE'` debe dar 0).
CREATE OR REPLACE FUNCTION validate_bet_selection_odds() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_batch_id uuid;
  v_bet_type text;
BEGIN
  IF NEW.visible_odds IS NULL THEN
    SELECT b.batch_id, b.bet_type INTO v_batch_id, v_bet_type FROM bets b WHERE b.id = NEW.bet_id;
    IF v_batch_id IS NULL
       AND v_bet_type IS DISTINCT FROM 'CREATED'
       AND NOT (v_bet_type = 'MULTIPLE' AND NEW.position > 0) THEN
      RAISE EXCEPTION 'Solo las apuestas de un lote de importación o de tipo Creada, y las condiciones internas de un leg de una Múltiple, pueden tener selecciones sin cuota'
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
       SELECT 1 FROM bet_selections s
       WHERE s.bet_id = NEW.id
         AND s.visible_odds IS NULL
         AND NOT (NEW.bet_type = 'MULTIPLE' AND s.position > 0)
     ) THEN
    RAISE EXCEPTION 'Una apuesta con selecciones sin cuota debe pertenecer a un lote de importación o ser de tipo Creada'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bet_selections_odds_required_outside_batch';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- 2. Disparador DIFERIDO (al confirmar): en una MULTIPLE ordinaria, toda fila sin cuota debe ser una
--    condición interna (`position > 0`) de un leg cuya fila `position = 0` SÍ tiene cuota. Diferido
--    porque editar las selecciones borra e inserta de nuevo (y el tipo cambia en la misma transacción).
CREATE FUNCTION check_bet_leg_odds() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_bet_id uuid;
  v_batch_id uuid;
  v_bet_type text;
BEGIN
  IF TG_TABLE_NAME = 'bets' THEN
    v_bet_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    v_bet_id := OLD.bet_id;
  ELSE
    v_bet_id := NEW.bet_id;
  END IF;
  SELECT b.batch_id, b.bet_type INTO v_batch_id, v_bet_type FROM bets b WHERE b.id = v_bet_id;
  IF NOT FOUND OR v_batch_id IS NOT NULL OR v_bet_type IS DISTINCT FROM 'MULTIPLE' THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM bet_selections s
    WHERE s.bet_id = v_bet_id
      AND s.visible_odds IS NULL
      AND (
        s.position = 0
        OR NOT EXISTS (
          SELECT 1 FROM bet_selections h
          WHERE h.bet_id = s.bet_id AND h.event_group = s.event_group
            AND h.position = 0 AND h.visible_odds IS NOT NULL
        )
      )
  ) THEN
    RAISE EXCEPTION 'Cada leg de una Múltiple necesita la cuota del leg en su primera selección'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bet_selections_leg_odds_required';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER bet_selections_check_leg_odds
  AFTER INSERT OR UPDATE OR DELETE ON bet_selections
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_bet_leg_odds();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER bets_check_leg_odds
  AFTER UPDATE OF bet_type ON bets
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_bet_leg_odds();
