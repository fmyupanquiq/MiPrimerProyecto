# Resumen de la Fase 9.0: análisis y decisiones para la migración del Excel

**Fecha:** 2026-09-26. **Estado:** documentación cerrada, lista para crear la rama de la Fase 9.1 (ver el final).
Documentos: `docs/decisiones/0020-migracion-historial-excel.md` y el §113 de `docs/ESPECIFICACION_LETFER_V1_1.md`.

## Qué se estudió

`Betsafe.xlsx` (el archivo de Betano no está disponible todavía). Es un registro de apuestas, no un sistema
financiero: 6 apuestas reales en una plantilla de 158 filas, un solo saldo inicial sin fecha, sin depósitos, retiros
ni transferencias, y con cifras calculadas por Excel (A+G, GANANCIA, Bank Actual) que no son datos oficiales.
Objetivo: **absorber el historial dentro del modelo LetFer, no replicar el Excel**.

## Decisiones cerradas

| Tema | Decisión |
|---|---|
| Alcance | Proyecto de ensayo primero, con guardia técnica de "proyecto apto" (D-X1). Los cálculos del Excel no se importan. |
| Casa | Sale del nombre del archivo, confirmada en la vista previa (D-X8). |
| Capital | `INITIAL_CAPITAL` histórico por casa, antes de la primera apuesta, con fecha desconocida (D-X3/D-X18, D-X29). |
| Etapas | Cada ronda es una etapa, con `starts_at` y `batch_id` (D-X7 principio, D-X28). |
| Retornos | Provisionales, calculados por LetFer; el A+G queda como control (D-X4). |
| Fechas | Sin hora: `placed_time_known = false`, 12:00 en la zona del proyecto; capital a las 00:00 del primer día; `settled_at = placed_at` (D-X5/D-X23, D-X20). |
| Orden del mismo día | N° solo como desempate; aviso amarillo si el peor orden dejaría saldo negativo (D-X16). |
| Monto y stake | Monto del Excel como monto oficial no confirmado; stake informativo, sin bloquear (D-X19). |
| Selecciones y tipo | Múltiples con cuota total y texto; cuota individual nula; tipo derivado del texto con aviso si difiere (D-X13, D-X15, D-X24). |
| Filas | Plantilla y vacías se ignoran; parciales se reportan y no se importan; nada se pierde en silencio (D-X21/D-X21b). |
| Identidad y duplicados | `sha256` del archivo + N°; duplicados por contenido reportados sin descartar (D-X10). |
| Lectura | Solo `.xlsx`, valores exactos como texto, librería fijada sin `^` (D-X12). |
| Escala | Pequeña, sin optimización previa (D-X14). |
| Semáforo | Verde, amarillo y rojo informativos; sin ajustes automáticos; rojo y parciales exigen reconocimiento con motivo, los errores de validación bloquean (D-X11/D-X17/D-X17b). |
| Ensayo | Setup con casas en cero y la unidad de la ronda 1; el capital entra por la vía histórica (D-X22). |
| Anulación | Apuestas del lote eliminadas con "Lote anulado", sin restauración individual, fuera de la papelera (D-X25). |
| Archivo y backup | Archivo original en el sistema con `sha256`; backup reciente obligatorio en importaciones reales (D-X26). |
| Escritura | Escritor propio con el motor financiero y validación de línea temporal completa (D-X27). |
| Modelo | `occurred_at_known` en movimientos (D-X29); `starts_at` y `batch_id` en etapas (D-X28). |
| Permisos y auditoría | `import.run` e `imports.view` para el Administrador de Proyecto; eventos por lote con la huella `sha256` (no `hash`). |

## Decisiones pendientes

| # | Pendiente | Depende de |
|---|---|---|
| **D-X7** | Unidad y fronteras exactas de cada etapa | Los archivos reales (Betsafe y Betano) |
| **D-B8** | Redondeo del retorno calculado | Retornos oficiales de Betsafe y Betano (tickets o historiales) |

## Qué depende del Excel de Betano

- **D-X7:** cuántas rondas hay, dónde empieza y termina cada una, su unidad y qué son las filas sobrantes de cada bloque
  (también hay que confirmarlo en Betsafe).
- **Calibración del analizador de selecciones** (9.2): textos reales de apuestas **Creada** y de múltiples de Betano,
  y valores reales de TIPO, RESULTADO y DEPORTE.
- **Confirmación de datos:** que N° es confiable como identidad, el significado real de FECHA (¿fecha real por fila
  o de plantilla?), el Bank Inicial de cada archivo, cifras de cabecera para el control, fórmulas sobrescritas y
  apuestas repetidas entre casas.
- **D-B8:** los retornos oficiales; el Excel no aporta evidencia del redondeo de la casa.

## Qué puede comenzar en la 9.1 sin el Excel de Betano

La 9.1 es solo modelo y escritura: no lee ningún archivo ni tiene interfaz.

1. Corregir el capital del dashboard para que use las filas vigentes del ledger (las reversiones de movimientos que no
   son de apuesta también cuentan), ampliando `assertFinancialInvariant`.
2. Migraciones: `import_batches`, `import_rows`, `batch_id` en `bets`, `financial_movements` y `stages`,
   `stages.starts_at`, `financial_movements.occurred_at_known` y cuota nula en selecciones con su disparador.
   Inmutabilidad tras importar.
3. Permisos `import.run` e `imports.view`, y la huella `sha256` en la auditoría (con prueba de que no se redacta).
4. Guardias: no restaurar una apuesta de un lote anulado, ocultarla de la papelera y filtrar por lote los retornos por
   confirmar.
5. Escritor de importación y anulación de lote, probados con datos sintéticos: invariante, integridad, idempotencia,
   línea de tiempo, backup previo y proyecto apto.

## Qué espera a datos reales (9.2 en adelante)

Lector `.xlsx`, clasificación de filas, analizador de selecciones y validación previa (9.2); vista previa, semáforo y
contraste con el Excel (9.3); confirmación de extremo a extremo (9.4); interfaz web (9.5); ensayo con los dos archivos
y revisión final (9.6).

## Estado para la rama

La documentación está lista para crear `fase-9.1/modelo-importacion`. El §113 ya está trasladado a la especificación.
D-X7 y D-B8 no bloquean el modelo.
