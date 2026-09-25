-- Administración (Fase 8, §111, ADR 0018): integridad garantizada por la base de datos.
--
-- 1. Solicitudes de eliminación de cuenta: `updated_at` automático y sin eliminación física (una
--    solicitud decidida es historia; se conserva siempre, como `withdrawal_requests`).
CREATE TRIGGER account_deletion_requests_updated_at BEFORE UPDATE ON account_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER account_deletion_requests_no_delete BEFORE DELETE ON account_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
--> statement-breakpoint
-- 2. El sistema nunca se queda sin un Administrador Global activo (§111.4, D8-10). Se rechaza
--    cualquier UPDATE que deshabilite, elimine lógicamente o degrade al último. Es la defensa en
--    profundidad de la comprobación del servicio: también cubre escrituras fuera de la API y dos
--    administradores que se deshabilitan a la vez. El bloqueo asesor usa la misma clave que
--    `lockByKey(tx, 'users:global-admins')`, así que ambas capas se serializan entre sí; al esperar
--    el bloqueo, el recuento posterior ya ve lo que confirmó la otra transacción.
CREATE FUNCTION protect_last_global_admin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  admin_role uuid;
  other_admins integer;
BEGIN
  SELECT id INTO admin_role FROM roles WHERE key = 'GLOBAL_ADMIN' AND is_system LIMIT 1;
  IF admin_role IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.global_role_id = admin_role AND OLD.status = 'ACTIVE'
     AND (NEW.global_role_id IS DISTINCT FROM admin_role OR NEW.status <> 'ACTIVE') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('users:global-admins', 0));
    SELECT count(*) INTO other_admins
      FROM users
     WHERE global_role_id = admin_role AND status = 'ACTIVE' AND id <> OLD.id;
    IF other_admins = 0 THEN
      RAISE EXCEPTION 'El sistema no puede quedarse sin un Administrador Global activo'
        USING ERRCODE = 'restrict_violation', CONSTRAINT = 'users_last_global_admin';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER users_protect_last_global_admin BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION protect_last_global_admin();
