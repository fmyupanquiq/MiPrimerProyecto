# Cierre de la Fase 9.3: de `ImportPreview` a una importación real

**Estado:** backend completo y probado (PostgreSQL real). Sin frontend. Sin integrar a `main`.
Referencias: ADR 0020 (`docs/decisiones/0020-migracion-historial-excel.md`), §113 de la
especificación, `docs/PLAN_FASE_9_3.md`, `docs/RESUMEN_FASE_9_2_CIERRE.md`.

## 1. Objetivo

Convertir la vista previa pura de la Fase 9.2 (`ImportPreview`, sin efectos) en una importación
real: persistir el staging, dejar que una persona resuelva lo que solo una persona puede resolver
(casa, plan de etapas, reconocimientos), calcular lo que falta (`stageKey`, `stake`) y, solo
entonces, escribir en el ledger con el escritor ya existente de la 9.1.5 — con endpoints HTTP
completos encima, y sin tocar la lógica financiera del escritor en ningún punto.

## 2. Arquitectura final

```
POST /import-batches (multipart)
  └─ ImportUploadService.upload()
       ├─ runImportAnalysisPipeline() [9.3.2, puro]
       ├─ import_batches (UPLOADED, origin fijado una sola vez)
       └─ import_rows (staging inmutable, D-X12)

POST /:id/house  → ImportResolutionService.confirmHouse()   (D-X8; UPLOADED→VALIDATED o corrección)
POST /:id/stage-plan → ImportResolutionService.saveStagePlan() (D-X7; valida forma y rangos, D-X10 no interviene aquí)
GET  /:id/preview → ImportBatchQueryService.preview()        (recalcula siempre; incluye duplicados D-X10)
POST /:id/acknowledge → ImportAcknowledgmentService.acknowledge() (D-X17b, con motivo)
      ImportAcknowledgmentService.canConfirmImport()          (bloqueo estructural + D-X17b + D-X10 + financiero)

POST /:id/confirm → ImportConfirmationService.confirmBatch()
      ├─ backup reciente (D-X26) o ensayo declarado
      ├─ assembleWriteInput(): canConfirmImport() → ImportBetResolutionService.resolveBatch() [9.3.5] → capital vigente
      └─ ImportWriterService.importBatch() [9.1.5, sin cambios]  → IMPORTED

POST /:id/annul → ImportConfirmationService.annulBatch()
      └─ ImportWriterService.annulBatch() [9.1.5, sin cambios]   → ANNULLED
```

Ningún servicio de la 9.3 escribe `bets`, `financial_movements` ni `stages` directamente: el único
punto de escritura al ledger sigue siendo `ImportWriterService` (9.1.5, intacto desde su propia
fase). La 9.3 solo prepara, valida y decide cuándo llamarlo.

## 3. Servicios (por orden de dependencia)

| Servicio | Fase | Responsabilidad |
|---|---|---|
| `ImportUploadService` | 9.3.3 | Sube el archivo, corre el pipeline puro, persiste `import_batches`/`import_rows`. |
| `ImportResolutionService` | 9.3.4 | Confirma/corrige la casa; guarda/reemplaza el plan de etapas. |
| `ImportBetResolutionService` | 9.3.5 | `stageKey`/`stake` desde el plan confirmado y el staging; construye `NormalizedImportBet[]`. |
| `ImportAcknowledgmentService` | 9.3.6 | Guarda el reconocimiento; `canConfirmImport()` centraliza si el lote puede confirmarse. |
| `ImportConfirmationService` | 9.3.7 | Ensambla `ImportBatchWriteInput`; `confirmBatch()`/`annulBatch()` llaman al escritor. |
| `ImportBatchQueryService` | 9.3.8 | Lecturas: listar, detalle, vista previa recalculada, archivo original. |
| `ImportWriterService` | 9.1.5 (sin cambios) | Único punto de escritura al ledger. |
| `BackupsService` | Fase 8 (extendido) | `hasRecentCompletedBackup()`, nuevo en la 9.3.7, para D-X26. |

Módulos puros sin base de datos (`apps/api/src/imports/parser/`): `import-preview-pipeline.ts`
(9.3.2), `import-duplicate-detection.ts` (9.3.9, D-X10 dentro del archivo). Con base de datos pero
de solo lectura: `import-duplicate-history.ts` (9.3.9, D-X10 contra el histórico).

## 4. Endpoints (`/api/projects/:projectId/import-batches`)

| Ruta | Permiso | Reauth |
|---|---|---|
| `POST /` | `import.run` | — |
| `GET /` | `imports.view` | — |
| `GET /:id` | `imports.view` | — |
| `GET /:id/preview` | `imports.view` | — |
| `POST /:id/house` | `import.run` | — |
| `POST /:id/stage-plan` | `import.run` | — |
| `POST /:id/acknowledge` | `import.run` | ✔️ |
| `POST /:id/confirm` | `import.run` | ✔️ |
| `POST /:id/annul` | `import.run` | ✔️ |
| `GET /:id/file` | `imports.view` | — |

## 5. Decisiones tomadas en la 9.3

- **9.3.2** — El adaptador de origen (`ImportOriginAdapter`) lo decide explícitamente quien llama,
  no el orquestador; extensión con `sheetName`/`financialContrast` opcionales.
- **9.3.4** — La corrección de casa mientras el lote sigue `VALIDATED` reutiliza el mismo evento de
  auditoría `import.batch_validated` (con `oldValues` fiel al estado real), en vez de crear un
  quinto evento.
- **9.3.6** — Solo el semáforo financiero **rojo** exige reconocimiento; el amarillo informa pero
  no bloquea (§113.7, confirmado sin cambios frente a una duda planteada durante la 9.3.6).
  `saveStagePlan()`/`acknowledge()` no generan ningún evento de auditoría nuevo.
  `ImportBetResolutionService.resolveBatch()` exige `VALIDATED`, no basta `UPLOADED`.
- **9.3.7** — La reautenticación (D6) no se comprueba en los servicios: vive en el controlador
  (`@RequireRecentAuth()`), igual que el resto de la aplicación. El backup reciente (D-X26) sí se
  comprueba en el servicio (`ImportConfirmationService`), por decisión explícita del usuario.
- **9.3.9 (auditoría de cierre)**:
  - **D-X10 completado.** Duplicados por contenido (misma fecha/monto/cuota/descripción
    normalizada, comparando por las selecciones ya parseadas, no por texto crudo): dentro del
    archivo, siempre calculado, puro; contra el histórico ya importado de la casa, solo cuando la
    casa está confirmada (necesita base de datos). Nunca bloquea ni descarta nada; exige el mismo
    reconocimiento que una fila parcial o el semáforo financiero en rojo. Un lote anulado no cuenta
    como histórico (sus apuestas ya están eliminadas lógicamente, D-X25). El hallazgo **no se
    persiste** en `import_rows.findings`: se recalcula siempre en `GET /:id/preview` y en
    `canConfirmImport()`, igual que el semáforo financiero (mismo criterio: `import_rows` es la
    fotografía inmutable del análisis, no una segunda copia de lo que se recalcula).
  - **`import_batches.origin` persistido.** El adaptador que leyó el archivo se fija una sola vez
    al subir y queda congelado desde la creación (mismo disparador que protege
    `original_name`/`source_sha256`, migraciones 0039/0040); `preview`, `acknowledge` y `confirm`
    ya no lo piden al cliente, lo leen del lote. Ver justificación completa en el ADR 0020.
  - **§113.9 corregido** (texto, sin cambio funcional): la vista previa usa `imports.view`, no
    `import.run`.

## 6. Pruebas

PostgreSQL real en todos los casos; ninguna prueba simula la base de datos. Cobertura por fase:
9.3.1–9.3.8 cada una con su propio archivo (`test/import-*.e2e-spec.ts`); 9.3.9 añadió:

- `import-duplicate-detection.spec.ts` (puro) y `import-duplicates.e2e-spec.ts` (D-X10 completo,
  dentro del archivo y contra el histórico, incluida la exclusión de lotes anulados).
- Invalidación de un checkpoint de conciliación al anular un lote importado (§112.5).
- Aislamiento entre proyectos (un lote del proyecto A responde 404 por la URL del proyecto B).
- Corrección ordinaria de una apuesta importada (`bets.correct-settlement`) y anulación posterior:
  se revierte lo **vigente**, no lo original (§113.8).
- Dos confirmaciones simultáneas del mismo lote: solo una completa, sin duplicar `bets` ni el
  evento de auditoría `import.batch_imported`.
- El flujo HTTP completo ahora también verifica el saldo de la casa y
  `assertFinancialInvariant`, no solo los códigos de respuesta.

## 7. Pendientes para la Fase 9.4

- **D-X7** — unidad y fronteras exactas de cada etapa: falta tu aprobación explícita y contrastarla
  con un archivo real de Betano.
- **D-B8** — política de redondeo del retorno calculado: sin retornos oficiales ni tickets de
  ninguna casa todavía.
- **"Creada" (D-X24)** — sin un ejemplo real que calibre su gramática de texto.
- **Inconsistencia documental de D-X23** en `apps/api/test/import-writer.e2e-spec.ts` (comentario
  y dato de prueba dicen "el día anterior"; el ADR y el código usan "el mismo día"). No es un
  defecto funcional; sigue pendiente un commit pequeño separado.
- **Ajuste de redacción del §113.6** sobre "vista previa ejecutada y revertida" (ya no describe la
  arquitectura real desde la 9.2.6): documentado como pendiente desde entonces, todavía sin tocar.
- **Frontend.** Ninguna pantalla se ha construido: subida, tabla de filas, editor del plan de
  etapas, panel de contraste financiero y de duplicados, diálogo de reconocimiento, confirmación.

## 8. Limitaciones actuales

- **Betano.** Sigue sin aparecer el archivo real en ningún sitio de la máquina (buscado en la
  9.2.0). Todo el pipeline es agnóstico de origen desde la 9.2.4, pero nada de eso se ha probado
  contra un archivo de Betano de verdad; D-X7 y D-B8 dependen de tenerlo.
  `IMPORT_ORIGIN_ADAPTERS` (`parser/import-origin-registry.ts`) solo registra `"Betsafe"` hoy.
- **Sin frontend.** Todo lo de esta fase se probó por servicio y por HTTP (`supertest`), nunca
  desde una interfaz real.
- **Backup real no probado de punta a punta.** Este entorno no tiene `pg_dump` disponible: las
  pruebas de backup reciente (D-X26) siembran el manifiesto directamente
  (`writeManifest`), como ya hacía `test/backups.e2e-spec.ts` desde la Fase 8. El camino
  `createBackup()` → `hasRecentCompletedBackup()` con un backup real de verdad solo se ha probado
  donde existen los binarios (fuera de este entorno).
- **`import_batches.origin` con un solo valor posible.** La columna ya existe y está protegida,
  pero con un único adaptador registrado no hay manera de probar un desajuste real entre lo subido
  y lo confirmado; esa prueba solo tendrá sentido cuando exista un segundo origen.
- **No hay purga ni edición del staging.** Sigue el mismo principio que el resto de la aplicación
  (Fase 8): `import_batches`/`import_rows` nunca se borran; solo se anula un lote.

## 9. Sin integrar

Todo el trabajo de la Fase 9.3 vive en la rama `fase-9.1/modelo-importacion`. No se ha integrado a
`main` ni se ha hecho `push`.
