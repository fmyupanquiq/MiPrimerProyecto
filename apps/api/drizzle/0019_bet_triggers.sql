-- Apuestas: integridad garantizada por la base de datos (spec §26, §40, §58, D2, §107).
--
-- `bets` nunca se elimina físicamente (se envía a la papelera, igual que una etapa); sí se
-- edita en el tiempo (§24), así que no lleva un disparador de campos protegidos como el de
-- `withdrawal_requests`. `bet_selections` sí se borra e inserta de nuevo por completo cuando
-- se editan las selecciones de una apuesta pendiente (reemplazo total, más simple que un diff
-- incremental): por eso no lleva `prevent_delete`.
CREATE TRIGGER bets_updated_at BEFORE UPDATE ON bets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER bets_no_delete BEFORE DELETE ON bets
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
