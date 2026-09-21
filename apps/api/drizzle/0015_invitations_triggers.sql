-- Invitaciones: integridad garantizada por la base de datos (spec §58, §81, §105.7).
--
-- 1. `updated_at` automático y sin eliminación física: una invitación se deshabilita, no se borra.
CREATE TRIGGER invitations_updated_at BEFORE UPDATE ON invitations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER invitations_no_delete BEFORE DELETE ON invitations
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
--> statement-breakpoint
-- 2. Las aceptaciones son un registro histórico: no se modifican ni se eliminan.
CREATE TRIGGER invitation_acceptances_immutable BEFORE UPDATE OR DELETE ON invitation_acceptances
  FOR EACH ROW EXECUTE FUNCTION prevent_modification();
--> statement-breakpoint
-- 3. Lo que define a una invitación (proyecto, rol, creador, token, uso, vencimiento y correo) no
--    cambia nunca, y su consumo o deshabilitación son irreversibles. Solo evolucionan
--    `consumed_*`, `disabled_*`, `version` y `updated_at`.
CREATE FUNCTION protect_invitation_fields() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.role_id IS DISTINCT FROM OLD.role_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.single_use IS DISTINCT FROM OLD.single_use
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.restricted_email IS DISTINCT FROM OLD.restricted_email
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Los datos que definen una invitación no se pueden modificar'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at)
     OR (OLD.consumed_by IS NOT NULL AND NEW.consumed_by IS DISTINCT FROM OLD.consumed_by)
     OR (OLD.disabled_at IS NOT NULL AND NEW.disabled_at IS DISTINCT FROM OLD.disabled_at)
     OR (OLD.disabled_by IS NOT NULL AND NEW.disabled_by IS DISTINCT FROM OLD.disabled_by) THEN
    RAISE EXCEPTION 'El consumo o la deshabilitación de una invitación no se pueden revertir'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invitations_protect_fields BEFORE UPDATE ON invitations
  FOR EACH ROW EXECUTE FUNCTION protect_invitation_fields();
