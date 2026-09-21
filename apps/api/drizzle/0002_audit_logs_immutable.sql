-- La auditoría es inmutable (spec §35): no se edita ni se elimina mediante flujos ordinarios.
CREATE TRIGGER audit_logs_no_modification BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_modification();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_modification();
