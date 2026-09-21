# 0004. Decimales, serialización y redondeo

- **Estado:** Aceptada (Fase 0). La política de redondeo debe confirmarse con tickets reales.
- **Fecha:** 2026-09-21
- **Referencias:** especificación §22, §56, §76, §77, §94; regla crítica 7

## Contexto

El §94 exige `NUMERIC` explícito en PostgreSQL, ninguna aritmética financiera con `number`, una
librería decimal en TypeScript, valores decimales como cadenas por la API y una política de
redondeo **centralizada, explícita y testeada**.

## Decisión

1. **Base de datos:** `NUMERIC(precision, scale)` en todas las columnas de dinero y cuotas.
2. **TypeScript:** aritmética con `decimal.js` (10.6.0). Se instalará cuando exista el primer
   módulo que la necesite (Fases 3 y 4), no antes.
3. **API:** los decimales se serializan como **cadenas** (`"195.48"`), nunca como `number` JSON.
4. **Un único módulo** de dinero en `packages/shared`, con pruebas, concentra el redondeo y las
   conversiones. Ninguna otra parte del código redondea por su cuenta.
5. **Redondeo:** `ROUND_HALF_UP` a **2 decimales** para PEN, aplicado **solo** a valores
   *calculados* por LetFer (`calculated_amount`, `calculated_return`, §76 y §77).
   - Los valores **oficiales** confirmados de la casa se almacenan tal como llegan; LetFer no los
     redondea (regla crítica 4).
   - Las cuotas se conservan sin redondeo destructivo (regla crítica 5).

## Escalas de partida (propuesta; se fijan al crear cada tabla)

| Concepto                                   | Tipo propuesto   | Motivo                                              |
| ------------------------------------------ | ---------------- | --------------------------------------------------- |
| Dinero (saldos, montos, retornos)          | `NUMERIC(18,2)`  | PEN opera con céntimos; margen amplio               |
| Cuota visible/oficial, cuota efectiva      | `NUMERIC(12,6)`  | Conserva precisión (`1.9548`) sin pérdida           |
| Stake (multiplicador)                      | `NUMERIC(10,4)`  | Permite `1.5`, `0.25`, etc.                         |

El §94 deja la escala definitiva a la implementación; estos valores no son una regla funcional y
pueden ajustarse al diseñar cada tabla (Fases 3 y 4).

## Pendiente de confirmación

- `ROUND_HALF_UP` es la elección estándar y es **provisional** por diseño: el retorno calculado
  siempre queda marcado como "no confirmado" y se reemplaza por el oficial (§77). Conviene
  contrastarlo con los tickets reales de Betano y Betsafe (¿redondean, truncan?) antes de la
  Fase 4. Si la casa trunca, el cambio es de una línea en el módulo único.
