-- Funciones reutilizables para proteger la integridad desde la base de datos (spec §58, §81).
--
-- set_updated_at: mantiene `updated_at` en cada UPDATE, sin depender de la aplicación.
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- prevent_delete: impide la eliminación física (el historial se conserva; el borrado es lógico).
CREATE FUNCTION prevent_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La eliminación física no está permitida en la tabla "%": use borrado lógico', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
-- prevent_modification: hace inmutable una tabla (p. ej. la auditoría, spec §35).
CREATE FUNCTION prevent_modification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Los registros de la tabla "%" son inmutables', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;
