-- Los análisis de IA son un histórico de solo inserción (§30, §110.5, ADR 0017): un reanálisis
-- crea una fila nueva, nunca edita ni borra la anterior. Reutiliza `prevent_modification`, ya
-- definida en 0000_base_functions.sql (mismo patrón que `audit_logs`, 0002).
CREATE TRIGGER ticket_analyses_no_modification BEFORE UPDATE OR DELETE ON ticket_analyses
  FOR EACH ROW EXECUTE FUNCTION prevent_modification();
--> statement-breakpoint
CREATE TRIGGER ticket_analyses_no_truncate BEFORE TRUNCATE ON ticket_analyses
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_modification();
--> statement-breakpoint
-- `tickets.updated_at` lo mantiene la aplicación al vincular `bet_id` (§110.3); mismo disparador
-- que el resto de tablas con `updated_at` (columns.ts: `timestamps()`).
CREATE TRIGGER tickets_set_updated_at BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
