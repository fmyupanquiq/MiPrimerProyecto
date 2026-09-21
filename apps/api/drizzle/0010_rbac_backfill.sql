-- RBAC (spec §4.5, §105.2), paso 2: roles de sistema y migración del rol de cada usuario.
--
-- Solo se crean las filas mínimas de los roles de sistema, que hacen falta para rellenar
-- `users.global_role_id` desde el `system_role` de la Fase 1. Los permisos de cada rol y el
-- nombre/descripción definitivos los sincroniza la aplicación al arrancar desde el catálogo de
-- `@letfer/shared` (fuente única de la matriz).
INSERT INTO roles (id, key, scope, name, description, is_system) VALUES
  (gen_random_uuid(), 'GLOBAL_ADMIN', 'GLOBAL', 'Administrador Global', '', true),
  (gen_random_uuid(), 'USER', 'GLOBAL', 'Usuario', '', true),
  (gen_random_uuid(), 'PROJECT_OWNER', 'PROJECT', 'Propietario', '', true),
  (gen_random_uuid(), 'PROJECT_ADMIN', 'PROJECT', 'Administrador de Proyecto', '', true),
  (gen_random_uuid(), 'COLLABORATOR', 'PROJECT', 'Colaborador', '', true),
  (gen_random_uuid(), 'READER', 'PROJECT', 'Lector', '', true)
ON CONFLICT (key) WHERE key IS NOT NULL DO NOTHING;
--> statement-breakpoint
-- Se desactiva el disparador de `updated_at` para no alterar la fecha de modificación de los
-- usuarios existentes: este cambio es interno y no una edición del usuario.
ALTER TABLE users DISABLE TRIGGER users_updated_at;
--> statement-breakpoint
UPDATE users
   SET global_role_id = (
     SELECT r.id FROM roles r
      WHERE r.key = CASE users.system_role::text WHEN 'GLOBAL_ADMIN' THEN 'GLOBAL_ADMIN' ELSE 'USER' END
   )
 WHERE global_role_id IS NULL;
--> statement-breakpoint
ALTER TABLE users ENABLE TRIGGER users_updated_at;
--> statement-breakpoint
-- Los roles llevan `updated_at` automático y no se eliminan físicamente.
CREATE TRIGGER roles_updated_at BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER roles_no_delete BEFORE DELETE ON roles
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
