-- Confianza y recuperación: integridad garantizada por la base de datos (§32, §38, §80, §109).
--
-- 1. `integrity_check_runs` es un registro histórico puro: inmutable desde que se crea, igual
--    que la auditoría (§35).
CREATE TRIGGER integrity_check_runs_no_modification BEFORE UPDATE OR DELETE ON integrity_check_runs
  FOR EACH ROW EXECUTE FUNCTION prevent_modification();
--> statement-breakpoint
-- 2. `reconciliation_checkpoints`: las cifras comparadas son inmutables desde que se crean
--    (D-C1, §109.1); la única mutación permitida es que el propio sistema pase el estado a
--    INVALIDATED (§109.1.3), una sola vez, sin poder revertirlo. Nunca se elimina.
CREATE TRIGGER reconciliation_checkpoints_no_delete BEFORE DELETE ON reconciliation_checkpoints
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
--> statement-breakpoint
CREATE FUNCTION protect_reconciliation_checkpoint_fields() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.house_id IS DISTINCT FROM OLD.house_id
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR NEW.letfer_available IS DISTINCT FROM OLD.letfer_available
     OR NEW.official_available IS DISTINCT FROM OLD.official_available
     OR NEW.committed IS DISTINCT FROM OLD.committed
     OR NEW.difference IS DISTINCT FROM OLD.difference
     OR NEW.performed_by IS DISTINCT FROM OLD.performed_by
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Un checkpoint de conciliación es inmutable: solo su estado puede pasar a INVALIDATED'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'INVALIDATED' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Un checkpoint invalidado no puede revertirse'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'INVALIDATED' THEN
    RAISE EXCEPTION 'Un checkpoint de conciliación solo puede pasar a INVALIDATED'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER reconciliation_checkpoints_protect_fields BEFORE UPDATE ON reconciliation_checkpoints
  FOR EACH ROW EXECUTE FUNCTION protect_reconciliation_checkpoint_fields();
