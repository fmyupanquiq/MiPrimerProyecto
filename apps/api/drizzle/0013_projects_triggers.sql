-- Proyectos y membresías: integridad garantizada por la base de datos (spec §58, §81, §105.4).
--
-- 1. `updated_at` automático y sin eliminación física (el historial se conserva; la papelera y las
--    salidas de miembros son estados, no borrados).
CREATE TRIGGER projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER projects_no_delete BEFORE DELETE ON projects
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
--> statement-breakpoint
CREATE TRIGGER project_members_updated_at BEFORE UPDATE ON project_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER project_members_no_delete BEFORE DELETE ON project_members
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
--> statement-breakpoint
-- 2. La membresía del propietario es siempre de Administrador de Proyecto y no puede quitarse
--    ni degradarse (§105.4). Se comprueba en cada INSERT o UPDATE de la membresía.
CREATE FUNCTION protect_owner_membership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  project_owner uuid;
  admin_role uuid;
BEGIN
  SELECT owner_id INTO project_owner FROM projects WHERE id = NEW.project_id;
  IF project_owner IS NOT NULL AND NEW.user_id = project_owner THEN
    SELECT id INTO admin_role FROM roles WHERE key = 'PROJECT_ADMIN';
    IF NEW.status <> 'ACTIVE' OR NEW.role_id IS DISTINCT FROM admin_role THEN
      RAISE EXCEPTION 'La membresía del propietario del proyecto no puede quitarse ni degradarse'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER project_members_protect_owner BEFORE INSERT OR UPDATE ON project_members
  FOR EACH ROW EXECUTE FUNCTION protect_owner_membership();
--> statement-breakpoint
-- 3. Al terminar la transacción, el propietario de un proyecto debe ser un miembro activo con rol
--    de Administrador de Proyecto. Es un disparador diferido: permite crear el proyecto y su
--    membresía (o transferir la propiedad) dentro de una misma transacción, en cualquier orden.
CREATE FUNCTION check_project_owner_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM project_members pm
      JOIN roles r ON r.id = pm.role_id
     WHERE pm.project_id = NEW.id
       AND pm.user_id = NEW.owner_id
       AND pm.status = 'ACTIVE'
       AND r.key = 'PROJECT_ADMIN'
  ) THEN
    RAISE EXCEPTION 'El propietario del proyecto debe ser un miembro activo con rol de Administrador de Proyecto'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER projects_owner_membership
  AFTER INSERT OR UPDATE OF owner_id ON projects
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_project_owner_membership();
