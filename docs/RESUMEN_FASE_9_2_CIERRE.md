# Cierre de la Fase 9.2: del Excel a un `ImportPreview`

**Fecha:** 2026-09-27. **Estado:** Fase 9.2 (subfases 9.2.0 a 9.2.6) completa en
`fase-9.1/modelo-importacion`, sin integrar a `main`, sin push, sin endpoints ni importación real.
Referencias: ADR 0020 (`docs/decisiones/0020-migracion-historial-excel.md`), §113 de
`docs/ESPECIFICACION_LETFER_V1_1.md`, `docs/RESUMEN_FASE_9_0.md` (cierre de la 9.0).

## 1. Objetivo de la Fase 9.2

Construir el **pipeline** que convierte un archivo `.xlsx` en una vista previa completa de lo que
se importaría (`ImportPreview`), sin escribir nunca al ledger ni crear nada real, y con una
separación estricta entre cuatro responsabilidades que antes no existían como código:

- **Análisis** (9.2.0): entender la estructura real de un archivo (fórmulas, validaciones de
  datos, estilos), no una suposición.
- **Normalización** (9.2.1-9.2.2, generalizada en 9.2.4): convertir filas crudas en el modelo
  intermedio que espera el escritor de la Fase 9.1, sin resolver todavía lo que depende de una
  etapa confirmada.
- **Validación** (9.2.3-9.2.4): clasificar filas y decidir qué bloquea, qué exige reconocimiento y
  qué es solo informativo (D-X17b) — **separada** de contrastar las cifras propias del archivo
  (9.2.5, §113.7, D-X11).
- **Vista previa** (9.2.6): unir todo lo anterior en una sola representación, sin leer el Excel
  una segunda vez y sin ningún efecto secundario.

Cada capa quedó **agnóstica de origen** desde la 9.2.4: nada salvo `betsafe-adapter.ts` menciona a
Betsafe, y esa separación se probó con un adaptador de fábrica que no es Betsafe.

## 2. Pipeline actual completo

```
Buffer (.xlsx)
  │
  ▼
xlsx-reader.ts            readWorkbook()                  → RawSheet[]
  │                       (envuelve exceljs; valores crudos, nunca el texto formateado)
  ▼
ImportOriginAdapter        (BETSAFE_ADAPTER; en el futuro, uno por cada origen)
  │                       columnas + vocabularios + separador de selecciones
  ▼
import-normalization.ts   normalizeImportSheet()          → ImportNormalizationResult
  │                       (row-classifier.ts + stage-candidates.ts + deriveBetType + noonInTimeZone)
  ▼
import-validation-report.ts buildImportValidationReport()  → ImportValidationReport   (D-X17b)
  │
  ▼
excel-financial-contrast.ts buildExcelFinancialContrast()  → ExcelFinancialContrastReport  (§113.7)
  │
  ▼
import-preview.ts          buildImportPreview()            → ImportPreview
```

Todas las funciones del pipeline son **puras**: mismos datos de entrada, mismo resultado, sin leer
ni escribir nada por su cuenta. Quien orquesta los pasos (todavía no existe como código de
producción; cada subfase de la 9.2 los probó por separado) es responsable de leer el archivo y
encadenarlos.

## 3. Qué está terminado

- **Fase 9.1 — modelo de importación.** `import_batches`/`import_rows` (migraciones 0032-0036),
  permisos (`import.run`, `imports.view`) y auditoría por lote, guardas de un lote anulado
  (D-X25), y el escritor (`ImportWriterService.importBatch`/`annulBatch`) con su anulación
  reversible. Probado con PostgreSQL real y datos sintéticos que ya respetan la forma de
  `ImportBatchWriteInput`.
- **Fase 9.2 — parser agnóstico.** Lector de `.xlsx` (`xlsx-reader.ts`), modelo genérico de hoja
  (`sheet-model.ts`), clasificador de filas en las cinco categorías de D-X21/D-X21b
  (`row-classifier.ts`), detector de candidatos de etapa con evidencia, nunca definitivos (D-X7,
  `stage-candidates.ts`), motor de normalización agnóstico (`import-normalization.ts`) y su
  adaptador de Betsafe (`betsafe-adapter.ts`, `betsafe-selections.ts`).
- **Vista previa.** `import-preview.ts`: archivo, resumen, capital detectado (con su casa
  candidata sin confirmar, D-X8), candidatos de etapa sin resolver, cada apuesta preliminar con su
  aviso de tipo (D-X24) y retorno provisional (D-X4), y el contraste financiero íntegro (§113.7).
- **El escritor de la 9.1.5 ya está listo para recibir datos normalizados**: su forma de entrada
  (`ImportBatchWriteInput`) es exactamente el objetivo final de este pipeline; solo falta la pieza
  que completa los dos campos que hoy quedan diferidos (siguiente punto).

## 4. Qué NO está terminado

- **Resolución de etapas.** Ningún candidato (`StageCandidate`) se convierte todavía en una etapa
  real (`NormalizedImportStage`); eso exige una decisión humana (D-X7 lo exige explícitamente:
  "el parser no debe convertir automáticamente bloques visuales en etapas definitivas").
- **Cálculo definitivo de `stageKey`/`stake`.** `PreliminaryNormalizedBet` (el tipo que usa todo
  el pipeline desde la 9.2.2) es literalmente `Omit<NormalizedImportBet, 'stageKey' | 'stake'>`
  porque los dos dependen de la etapa confirmada del punto anterior. Sin esto, nada de lo
  normalizado puede llegar al escritor.
- **Endpoints.** No existe ninguna ruta HTTP para subir, validar, previsualizar, confirmar ni
  anular un lote.
- **Flujo de confirmación humana.** El semáforo estructural (`BLOCKED`/`NEEDS_ACKNOWLEDGMENT`/`OK`)
  y el financiero (`GREEN`/`YELLOW`/`RED`) ya se calculan, pero no existe el paso que registra el
  reconocimiento explícito con motivo que exige D-X17b para una fila roja o parcial.
- **Backup y reautenticación.** Nada verifica todavía un backup reciente (D-X26) ni exige
  reautenticación antes de confirmar.
- **Importación real.** Nadie ha ejecutado el pipeline completo contra el archivo real de
  Betsafe (solo se analizó su estructura en la 9.2.0; todas las pruebas de código usan archivos
  sintéticos con la misma forma, nunca el archivo de la persona).

> **Nota añadida en la auditoría de cierre de la 9.3.9:** esta lista no incluyó en su momento los
> **duplicados por contenido** de D-X10 (solo la huella del archivo completo estaba prevista aquí y
> en el escritor de la 9.1.5). Nadie los diferió a propósito: se perdieron entre este documento y
> `docs/PLAN_FASE_9_3.md`, y solo se detectaron y completaron en la 9.3.9. Ver
> `docs/RESUMEN_FASE_9_3_CIERRE.md`.

## 5. Decisiones pendientes

- **D-X7** — unidad y fronteras exactas de cada etapa. La unidad (12.5) está reconfirmada por los
  montos reales de Betsafe; falta tu aprobación explícita y contrastarla con Betano. Las fronteras
  dependen de si Betano marca sus rondas con un rótulo visible o solo por posición (hallazgo de la
  9.2.0): sin el archivo no se puede saber cuál convención sigue.
- **D-B8** — redondeo del retorno calculado. Sigue sin retornos oficiales ni tickets de ninguna de
  las dos casas.
- **"Creada" (D-X24).** Sin un ejemplo real que calibre su gramática de texto; hoy se trata igual
  que "Simple" y siempre mostraría `typeMismatch` si apareciera.
- **Inconsistencia documental de D-X23** en `apps/api/test/import-writer.e2e-spec.ts` (Fase 9.1.5,
  ya aprobada): su comentario y su dato de prueba (`CAPITAL_AT`) dicen "00:00 del día anterior a la
  primera apuesta"; el ADR 0020 y la 9.2.6 usan la medianoche del **mismo día**. No es un defecto
  funcional (el escritor solo exige que el capital sea estrictamente anterior, y un día antes
  también lo cumple), pero queda anotada para un commit pequeño separado, todavía sin hacer.

## 6. Requisitos para Betano

1. **El archivo en sí.** Sigue sin aparecer en la máquina (se buscó en todo el perfil del usuario
   durante la 9.2.0).
2. **Estructura de rondas (D-X7).** Si Betano marca varias rondas reales con un rótulo visible o
   solo por posición, y cuál es su unidad.
3. **Cabeceras.** Confirmar que Bank Inicial, Bank Actual y el total de Ganancia están en las
   mismas celdas que en Betsafe, o construir su propio `ExcelFinancialContrastConfig` si no.
4. **Vocabularios.** Confirmar (o corregir) las columnas y los vocabularios de RESULTADO, TIPO y
   DEPORTE que hoy `BETSAFE_TEMPLATE` solo asume iguales, por lo que indicó la persona responsable
   en la Fase 9.0 ("mismas columnas"), sin haberlo confirmado todavía contra el archivo real.
5. **Retornos oficiales.** Tickets o historiales de Betano (y de Betsafe) para decidir D-B8.
6. **Un ejemplo real de "Creada"**, si existe en ese archivo.

Ninguna pieza de código construida en la 9.1 o la 9.2 depende de Betano para funcionar: todo se
probó como agnóstico de origen. Lo que falta es **información del archivo real**, no
infraestructura.

## 7. Entrada a la Fase 9.3

**Objetivo de la Fase 9.3:** convertir un `ImportPreview` en una importación confirmable mediante
intervención humana, sin perder trazabilidad.

Esto implica, en algún orden todavía por planificar en detalle (no se decide aquí):

- una persona confirma o ajusta los candidatos de etapa de un `ImportPreview` en etapas reales
  (D-X7 deja de estar "sin resolver" para un lote concreto, aunque la decisión general de D-X7
  sobre unidad y convención sigue pendiente hasta ver Betano);
- con esa confirmación, se completan `stageKey` y `stake` de cada apuesta preliminar;
- el semáforo estructural y el financiero quedan reconocidos explícitamente cuando hace falta
  (D-X17b), con motivo y reautenticación;
- solo entonces el resultado, ya completo, se le puede entregar al escritor de la 9.1.5.

No se decide en este documento si la 9.3 incluye ya los endpoints o si estos quedan para una
subfase posterior; eso se planifica al iniciar la 9.3.
