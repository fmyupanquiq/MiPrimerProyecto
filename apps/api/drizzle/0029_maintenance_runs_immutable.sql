-- Las ejecuciones de mantenimiento son un histórico de solo inserción (§111.6, ADR 0018): cada
-- purga deja su registro y nunca se edita ni se borra. Reutiliza `prevent_modification`, ya
-- definida en 0000_base_functions.sql (mismo patrón que `ticket_analyses`, 0025).
CREATE TRIGGER maintenance_runs_no_modification BEFORE UPDATE OR DELETE ON maintenance_runs
  FOR EACH ROW EXECUTE FUNCTION prevent_modification();
--> statement-breakpoint
CREATE TRIGGER maintenance_runs_no_truncate BEFORE TRUNCATE ON maintenance_runs
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_modification();
