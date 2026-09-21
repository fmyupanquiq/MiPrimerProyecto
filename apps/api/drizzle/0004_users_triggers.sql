-- users: `updated_at` automático y sin eliminación física (spec §8, §81, §102).
-- La identidad histórica se conserva siempre; el borrado es lógico (status = 'DELETED').
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER users_no_delete BEFORE DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
