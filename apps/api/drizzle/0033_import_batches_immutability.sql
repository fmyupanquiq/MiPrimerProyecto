-- Lotes de importación del historial (Fase 9.1.2a, §113, ADR 0020): inmutabilidad garantizada por la
-- base de datos.
--
-- 1. `updated_at` lo mantiene `set_updated_at` (0000_base_functions.sql), como en el resto de tablas.
CREATE TRIGGER import_batches_set_updated_at BEFORE UPDATE ON import_batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
-- 2. Un lote nunca se borra (se anula) ni se vacía la tabla. Reutiliza `prevent_delete` y
--    `prevent_modification` (0000_base_functions.sql).
CREATE TRIGGER import_batches_no_delete BEFORE DELETE ON import_batches
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
--> statement-breakpoint
CREATE TRIGGER import_batches_no_truncate BEFORE TRUNCATE ON import_batches
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_modification();
--> statement-breakpoint
CREATE TRIGGER import_rows_no_truncate BEFORE TRUNCATE ON import_rows
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_modification();
--> statement-breakpoint
-- 3. Ciclo de vida de un lote (§113.2, §113.8):
--    - el archivo, su huella, su nombre, el proyecto y quién lo subió no cambian jamás;
--    - un lote `IMPORTED` solo puede pasar a `ANNULLED` y únicamente cambian los campos de la
--      anulación (más `updated_at` y `version`): contadores, informe, plan de etapas, casa y datos
--      de la importación quedan fijos;
--    - un lote `ANNULLED` no vuelve a cambiar;
--    - solo se anula un lote importado y solo se importa uno validado.
CREATE FUNCTION import_batches_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id
     OR NEW.project_id <> OLD.project_id
     OR NEW.original_name <> OLD.original_name
     OR NEW.source_sha256 <> OLD.source_sha256
     OR NEW.source_size_bytes <> OLD.source_size_bytes
     OR NEW.created_by <> OLD.created_by
     OR NEW.created_at <> OLD.created_at
     OR NEW.source_file IS DISTINCT FROM OLD.source_file THEN
    RAISE EXCEPTION 'El archivo original de un lote de importación no se puede modificar'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'ANNULLED' THEN
    RAISE EXCEPTION 'Un lote de importación anulado es inmutable'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'IMPORTED' THEN
    IF NEW.status <> 'ANNULLED' THEN
      RAISE EXCEPTION 'Un lote de importación importado solo puede anularse'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.house_id IS DISTINCT FROM OLD.house_id
       OR NEW.is_rehearsal <> OLD.is_rehearsal
       OR NEW.stage_plan IS DISTINCT FROM OLD.stage_plan
       OR NEW.report IS DISTINCT FROM OLD.report
       OR NEW.rows_total <> OLD.rows_total
       OR NEW.rows_valid <> OLD.rows_valid
       OR NEW.rows_template <> OLD.rows_template
       OR NEW.rows_empty <> OLD.rows_empty
       OR NEW.rows_partial <> OLD.rows_partial
       OR NEW.rows_invalid <> OLD.rows_invalid
       OR NEW.validated_at IS DISTINCT FROM OLD.validated_at
       OR NEW.validated_by IS DISTINCT FROM OLD.validated_by
       OR NEW.imported_at IS DISTINCT FROM OLD.imported_at
       OR NEW.imported_by IS DISTINCT FROM OLD.imported_by
       OR NEW.import_reason IS DISTINCT FROM OLD.import_reason THEN
      RAISE EXCEPTION 'Un lote de importación importado solo admite los datos de su anulación'
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSE
    IF NEW.status = 'ANNULLED' THEN
      RAISE EXCEPTION 'Solo se puede anular un lote de importación ya importado'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status = 'IMPORTED' AND OLD.status <> 'VALIDATED' THEN
      RAISE EXCEPTION 'Solo se puede importar un lote de importación ya validado'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER import_batches_guard BEFORE UPDATE ON import_batches
  FOR EACH ROW EXECUTE FUNCTION import_batches_guard();
--> statement-breakpoint
-- 4. Filas de staging (§113.6): sus valores originales y su posición nunca cambian; mientras el lote
--    no está importado se pueden reescribir y borrar (nueva validación); desde `IMPORTED` no se
--    inserta, modifica ni borra ninguna fila.
CREATE FUNCTION import_rows_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  batch_status import_batch_status;
BEGIN
  SELECT status INTO batch_status FROM import_batches
    WHERE id = CASE WHEN TG_OP = 'INSERT' THEN NEW.import_batch_id ELSE OLD.import_batch_id END;
  IF batch_status IN ('IMPORTED', 'ANNULLED') THEN
    RAISE EXCEPTION 'Las filas de un lote de importación importado son inmutables'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.import_batch_id <> OLD.import_batch_id
       OR NEW.row_number <> OLD.row_number
       OR NEW.raw_values IS DISTINCT FROM OLD.raw_values THEN
      RAISE EXCEPTION 'Los valores originales de una fila de importación no se pueden modificar'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER import_rows_guard BEFORE INSERT OR UPDATE OR DELETE ON import_rows
  FOR EACH ROW EXECUTE FUNCTION import_rows_guard();
