# 0015. Dashboard, métricas y gráficos

- **Estado:** Aceptada (Fase 5)
- **Fecha:** 2026-09-23
- **Referencias:** especificación §33, §34, §59 a §60, §91, §92, §108

## Contexto

La Fase 5 añade el tablero de análisis del proyecto: estado financiero actual, indicadores
filtrados (P/L, Yield, ROI), desgloses por etapa/casa/deporte/mercado/periodo, y los gráficos
mínimos exigidos por el §34 (evolución de banca, distribución por casas). Diez decisiones (D-M1 a
D-M10) las tomó la persona responsable del producto y se documentan aquí y en la especificación
(§108).

## Decisiones funcionales (confirmadas)

- **D-M1.** Yield (P/L ÷ total apostado) y ROI (P/L ÷ capital invertido) son métricas distintas.
- **D-M2.** El Dashboard amplía la pantalla "Resumen" existente; no es una pestaña nueva.
- **D-M3.** Evolución de banca real y curva de rendimiento son dos series distintas (§91); el
  drawdown se calcula sobre la segunda.
- **D-M4.** Una apuesta múltiple con selecciones de distinto deporte/mercado cuenta como "Mixto"
  en esos desgloses, nunca se cuenta su P/L más de una vez.
- **D-M5.** Cash Out es un bucket propio en los conteos, no se funde con Ganada/Perdida.
- **D-M6.** El drawdown se muestra en soles y en porcentaje del pico.
- **D-M7.** El rendimiento por periodo se agrupa por `settledAt`, no por `placedAt`.
- **D-M8.** Sin permiso `dashboard.view` nuevo: se exige `bets.view` + `houses.view` +
  `movements.view`, que todo rol de proyecto ya tiene.
- **D-M9.** Recharts como librería de gráficos, con versión fijada (sin `^`).
- **D-M10.** Todo se calcula en consulta mediante SQL agregado; sin tablas de resumen
  materializadas.

## Decisión técnica

### Sin migraciones

El dashboard no introduce ninguna tabla ni columna: deriva enteramente de `bets`,
`bet_selections`, `financial_movements`, `stages` y `houses`, ya existentes desde las Fases 3 y 4.

### Agregación en SQL, no en JavaScript

A diferencia de `balances.ts`/`bets.service.ts` (que traen filas y suman en memoria — razonable a
la escala de "saldos de una casa"), las consultas del dashboard agregan potencialmente miles de
filas de `bets`/`financial_movements`. Se implementan con `SUM`/`COUNT`/`GROUP BY` y funciones de
ventana de PostgreSQL:

- **Evolución de banca**: `SUM(caso CREDIT/DEBIT) OVER (ORDER BY occurred_at)` sobre
  `financial_movements` del proyecto (o de una casa, si se filtra), incluyendo todos los tipos.
- **Curva de rendimiento**: la misma técnica, pero solo sobre `BET_PLACEMENT`/`BET_SETTLEMENT`.
- **Drawdown**: `MAX(acumulado) OVER (ORDER BY occurred_at)` menos el acumulado en cada punto, y
  ese mismo valor dividido por el pico para el porcentaje.
- **Desgloses** (por casa/etapa/deporte/mercado/periodo): `GROUP BY` sobre `bets` liquidadas,
  uniendo `bet_selections` cuando el desglose es por deporte/mercado. El caso "Mixto" (D-M4) se
  resuelve comprobando si `COUNT(DISTINCT sport)`/`COUNT(DISTINCT market)` de las selecciones de
  la apuesta es 1 (se usa ese valor) o más de 1 (se cuenta como `'Mixto'`).
- **Agrupación temporal** (D-M7): `date_trunc` sobre `settled_at`, convertido primero a la zona
  horaria del proyecto (§93), igual que ya hace `startOfDayInTimeZone` (Fase 4) para el límite
  diario del Colaborador — aquí se necesita el equivalente para agrupar por día/semana/mes, no
  solo para calcular el inicio del día actual.

### Endpoints

Cuatro rutas bajo `/projects/:id/dashboard`, reflejando la separación del §33 entre estado actual
y análisis filtrado, y evitando que el estado (consultado con frecuencia, sin filtros) cargue
series temporales completas:

- `GET /status` — capital actual, disponible, comprometido, distribución por casa, conteos de
  apuestas por estado. Sin filtros: la foto de ahora mismo.
- `GET /analysis` — P/L, Yield, ROI, depósitos/retiros/extraordinarios del periodo, conteos, y
  desgloses por casa/etapa/deporte/mercado/periodo. Acepta los filtros del §33 (etapa, periodo,
  casa, deporte, tipo, usuario, resultado, stake).
- `GET /bankroll-chart` — serie temporal de la evolución de banca real, con marcadores de cambio
  de etapa.
- `GET /performance-chart` — serie temporal de la curva de rendimiento y el drawdown en cada
  punto.

Los cuatro se protegen con la combinación de permisos del D-M8 (§108.8), verificada en el
controlador (no en un guard nuevo: se reutiliza `@ProjectRoute` con una comprobación adicional,
igual que ya hace `BetsController` para el filtro `?status=TRASHED`).

### Recharts (D-M9)

Se añade `recharts` (versión exacta fijada en `package.json`) como dependencia de `apps/web`,
compatible con React 19 (peer dependency `^19.0.0`). Es la primera librería de gráficos del
proyecto.

## Consecuencias

- El endpoint `GET /status` puede consultarse con frecuencia (es la vista por defecto al entrar al
  proyecto); los otros tres solo se piden cuando la persona usuaria interactúa con los filtros o
  desplaza el rango de fechas.
- Si el rendimiento de las consultas agregadas resultara insuficiente con datos reales (no
  esperado en el volumen de un equipo pequeño, §60), la vía de mejora sería añadir índices
  adicionales sobre `financial_movements(project_id, occurred_at)` y `bets(project_id,
  settled_at)` — ya existe un índice parecido en `bets`, se ampliaría si hiciera falta — nunca
  materializar un resumen que compita con el ledger como fuente de verdad.
- Cuando la Fase 6 (conciliación) exista, el dashboard podrá incorporar el estado "requiere nueva
  conciliación" sin cambiar esta arquitectura, porque ya consulta `houses` para la distribución
  por casa.
