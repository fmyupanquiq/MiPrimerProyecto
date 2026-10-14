# 0022. Estructura TICKET → LEG → CONDICIÓN

- **Estado:** Aceptada e implementada en desarrollo (no aplicada a producción).
- **Referencias:** especificación §20, §90, §107.4, §110, §113.5, §114; ADR 0017, 0019.

## Contexto

Una Múltiple podía contener un Bet Builder, pero el modelo lo obligaba a convertirlo en dos apuestas
independientes con una cuota inventada en cada una (caso real: Combinada de 4 de Betano, leg 2 con cuota
2.47 y dos condiciones, leída como 5 selecciones con 1.52 repetido). Las reglas de cuota (servicio y
disparador de 0041) exigían cuota en cada fila de una Múltiple.

## Decisión

1. **Sin tabla `bet_legs`:** `event_group` ya es el leg y `position` el orden de las condiciones. Una tabla
   nueva habría obligado a mover cuotas existentes y a mantener dos autoridades para un mismo valor.
2. **La cuota del leg vive en la fila `position = 0`** (`visible_odds`). Las condiciones internas no tienen
   cuota. Es una convención documentada y comprobada por la API y por la base de datos.
3. **Migraciones aditivas** (0042: columnas documentales nulas `leg_score`, `leg_result`, `condition_status`,
   `external_reference` y sus `CHECK`) **y de reglas** (0043): el disparador por fila se relaja y un
   `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` comprueba al confirmar que cada leg de una
   Múltiple ordinaria tiene cuota en su fila principal. Es diferido porque un disparador por fila no ve las
   filas hermanas de un `INSERT` múltiple, y editar borra y reinserta las selecciones.
4. **Contrato de IA aditivo:** `selections[]` siguen siendo los legs; `conditions[]` solo en un leg creado.
   Se descartó `legs[]` (renombre sin ventaja) y la cadena "A; B" en `selection` (heurística sobre texto).
5. **Validación única:** `validateSelectionStructure` (`@letfer/shared`) la usan la API y la web.

## Consecuencias

- Las apuestas existentes no cambian (la regla solo se relaja; probado sobre una base con las migraciones
  hasta 0041 y datos de los cuatro tipos). Rollback: una migración nueva que restaure las funciones de 0041 y
  elimine los disparadores nuevos; solo es segura mientras no exista una Múltiple ordinaria con filas internas
  sin cuota.
- Límites: el nombre impreso del bloque y las cuotas por condición no se persisten; los informes por mercado
  cuentan una Creada dentro de una Múltiple bajo cada uno de sus mercados.
- No se aplicó ninguna migración a la base de producción.
