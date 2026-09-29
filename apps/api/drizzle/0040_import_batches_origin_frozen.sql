-- `origin` (Fase 9.3.9, D-X-origin): el adaptador que leyó el archivo pertenece al lote, nunca es
-- una interpretación humana corregible como `house_id` — se congela desde la creación, igual que
-- `original_name`/`source_sha256`/`source_file`, no solo a partir de `IMPORTED`.
--
-- Esto reemplaza por completo la función `import_batches_guard()` de la migración 0038 (no se
-- edita esa migración ya aplicada): el cuerpo es el mismo, con `origin` añadido al primer bloque
-- de campos que nunca cambian, en cualquier estado.
CREATE OR REPLACE FUNCTION import_batches_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id
     OR NEW.project_id <> OLD.project_id
     OR NEW.origin <> OLD.origin
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
       OR NEW.import_reason IS DISTINCT FROM OLD.import_reason
       OR NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at
       OR NEW.acknowledged_by IS DISTINCT FROM OLD.acknowledged_by
       OR NEW.acknowledgment_reason IS DISTINCT FROM OLD.acknowledgment_reason THEN
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
