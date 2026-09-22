-- Finanzas: integridad garantizada por la base de datos (spec §16, §40, §58, §72, §79, D2, D5).
--
-- 1. Etapas y casas: `updated_at` automático y sin eliminación física (una etapa se envía a la
--    papelera, nunca se borra; una casa se desactiva, nunca se borra).
CREATE TRIGGER stages_updated_at BEFORE UPDATE ON stages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER stages_no_delete BEFORE DELETE ON stages
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
--> statement-breakpoint
CREATE TRIGGER houses_updated_at BEFORE UPDATE ON houses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER houses_no_delete BEFORE DELETE ON houses
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
--> statement-breakpoint
-- 2. El ledger es inmutable tras confirmarse (D2): ni se modifica ni se elimina. Una corrección
--    se hace con un movimiento nuevo, nunca editando uno existente.
CREATE TRIGGER financial_movements_immutable BEFORE UPDATE OR DELETE ON financial_movements
  FOR EACH ROW EXECUTE FUNCTION prevent_modification();
--> statement-breakpoint
-- 3. Solicitudes de retiro: sí cambian de estado (pendiente → aprobado/rechazado/cancelado, D5),
--    pero nunca se eliminan y sus datos originales (a qué proyecto/etapa/casa, cuánto, quién y
--    por qué lo pidió) no se alteran una vez tomada la decisión, ni la decisión se revierte.
CREATE TRIGGER withdrawal_requests_updated_at BEFORE UPDATE ON withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER withdrawal_requests_no_delete BEFORE DELETE ON withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
--> statement-breakpoint
CREATE FUNCTION protect_withdrawal_fields() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.stage_id IS DISTINCT FROM OLD.stage_id
     OR NEW.house_id IS DISTINCT FROM OLD.house_id
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Los datos de una solicitud de retiro no se pueden modificar'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'PENDING' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'La decisión sobre una solicitud de retiro no se puede revertir'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER withdrawal_requests_protect_fields BEFORE UPDATE ON withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION protect_withdrawal_fields();
