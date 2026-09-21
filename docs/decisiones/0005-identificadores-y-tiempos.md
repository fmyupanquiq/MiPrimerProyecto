# 0005. Identificadores, tiempos y esquema de usuarios

- **Estado:** Aceptada (Fase 1)
- **Fecha:** 2026-09-21
- **Referencias:** especificación §2, §55, §81, §93, §96, §102, §104

## Contexto

El ADR 0001 dejó a la Fase 1 la estrategia de identificadores. El §2 exige un ID permanente para
el usuario (identidad canónica) y el §93 exige guardar los instantes de forma no ambigua.

## Decisión

- **Identificadores UUIDv7 generados en la aplicación** (`uuid` 14.0.2, función `newId()`), como
  clave primaria de todas las tablas. PostgreSQL 17 no trae `uuidv7()` nativo, y UUIDv7 conserva
  el orden temporal (mejor localidad de índices que un UUIDv4). Los tests verifican versión 7 y
  orden creciente.
- **Instantes como `timestamptz`** (UTC en persistencia; la presentación en la zona del proyecto
  llega con los proyectos, Fase 2). Ninguna columna de fecha usa `timestamp` sin zona.
- **`created_at`, `updated_at`, `version`, `deleted_at` y `deletion_reason` como ayudantes de
  esquema reutilizables** (`schema/columns.ts`). `updated_at` lo mantiene el disparador
  `set_updated_at` de PostgreSQL, no la aplicación.
- **Enums de estado y rol definidos una sola vez** en `@letfer/shared` (`USER_STATUSES`,
  `SYSTEM_ROLES`) y reutilizados por el esquema de Drizzle, para que API y web no diverjan.
- **Correo**: se guarda normalizado (sin espacios y en minúsculas) y el índice único es sobre
  `lower(email)`. Las restricciones `CHECK` del esquema impiden nombres en blanco, correos con
  espacios y un estado `DELETED` sin `deleted_at` (y viceversa).
- **Los usuarios no se eliminan físicamente**: un disparador `prevent_delete` rechaza el `DELETE`
  (§8). Las claves foráneas hacia `users` son `ON DELETE RESTRICT`.

## Consecuencias

- Todos los ID son UUID de 36 caracteres; no son secretos y revelan el momento de creación, algo
  aceptable en un sistema privado.
- Los correos deben ser ASCII (lo que valida `z.email()`); ampliarlo a internacionalizados
  requeriría revisar la unicidad, porque `lower()` de PostgreSQL con colación `C` solo baja ASCII.
- `login_attempts.seq` (identidad `bigint`) se añadió después de detectar que ordenar por marca de
  tiempo descartaba fallos con la misma marca (ADR 0006).
