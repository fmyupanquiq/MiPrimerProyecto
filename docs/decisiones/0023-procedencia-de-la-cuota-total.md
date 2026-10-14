# 0023. Procedencia de la cuota total

- **Estado:** Aceptada e implementada en desarrollo y pruebas (no aplicada a producción).
- **Referencias:** regla crítica 6 (los valores oficiales prevalecen sobre cálculos teóricos); ADR 0019, 0022.

## Contexto

`bets.visible_total_odds` es obligatoria. Cuando un ticket no muestra la cuota total (caso Betano: 4 legs
con 2.15, 2.47, 1.21 y 1.31; producto 8.41767355), LetFer guardaba una referencia calculada (8.42) y la
presentaba como "Cuota total", indistinguible de una cifra oficial de la casa.

## Decisión

1. **Un solo valor, con procedencia:** `visible_total_odds` sigue siendo el único número. La columna nueva
   `total_odds_source` (enum `OFFICIAL` | `CALCULATED` | `UNKNOWN`) dice qué es. No hay un segundo campo
   numérico autoritativo (se descartó una columna `calculated_total_odds`).
2. **Migración 0044 aditiva:** `ADD COLUMN ... NOT NULL DEFAULT 'UNKNOWN'`. Toda apuesta existente (también
   las importadas) queda `UNKNOWN`: no se reescribe ninguna cuota ni se marca oficial por suposición.
3. **API:** `totalOddsSource` opcional al crear (si se omite, `UNKNOWN`). Al editar una pendiente: la
   procedencia explícita manda; cambiar el valor sin indicarla la deja `UNKNOWN`; el mismo valor la conserva.
   En una liquidada no se edita por la vía ordinaria. Es un cambio documental: no toca importes, retornos,
   ganancias ni el ledger.
4. **Formulario:** en Múltiple/Creada la persona declara si la cuota es oficial o calculada de referencia
   (la lectura de IA la preselecciona: cuota visible ⇒ oficial; calculada por LetFer ⇒ referencia). Nunca se
   supone que una cifra tecleada es la oficial. El producto de las cuotas solo se ofrece si TODOS los legs
   tienen la suya, y se redondea a 2 decimales (política provisional D-B8, sin cambios).
5. **Presentación:** oficial ⇒ "Cuota total oficial"; calculada ⇒ "Cuota total oficial: —" y aparte
   "Cuota calculada de referencia" con su aviso; desconocida ⇒ "Cuota total (origen no verificado)";
   sin dato ⇒ "no disponible". El retorno potencial calculado con una referencia lo indica.

## Consecuencias

- Rollback: `DROP COLUMN total_odds_source` y `DROP TYPE total_odds_source`; solo se pierde la procedencia.
- Límite: la precisión completa del producto (6 decimales) no se almacena; se guarda a 2 decimales por la
  política provisional vigente. Cambiarla es una decisión financiera pendiente.
- Seguridad relacionada: `BetDetail.tickets` solo se devuelve con `tickets.view` (decide el backend).
- No se aplicó ninguna migración a la base de producción.
