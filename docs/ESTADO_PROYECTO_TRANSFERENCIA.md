# Estado del proyecto — transferencia

## Estado actual

- **Fase completada:** 9.3 (backend completo de importación histórica: subida, resolución humana,
  reconocimientos, confirmación/anulación reales, endpoints HTTP, auditoría de cierre 9.3.9).
- **Rama actual:** `fase-9.1/modelo-importacion` (toda la Fase 9 vive aquí; no está integrada a
  `main`).
- **Último commit:** `336b309` — `feat(imports): complete phase 9.3 audit and safeguards`.
- **Qué está funcionando:** el backend completo, con PostgreSQL real y `npm run check` en verde
  (133 pruebas de `shared`, 1182 de `api` con 2 *skips* conocidos, 265 de `web`, build incluido).
  Sin frontend. Sin integrar a `main`. Sin `push`.

## Arquitectura actual de importación

```
XLSX (Buffer)
  │
  ▼
xlsx-reader (exceljs) ──► RawSheet
  │
  ▼
ImportOriginAdapter (Betsafe; plantilla de columnas, gramática de selecciones,
  vocabulario de tipos, contraste financiero opcional)
  │
  ▼
normalizeImportSheet ──► ImportNormalizationResult
  (candidatos de etapa D-X7, apuestas preliminares sin stageKey/stake, informe por fila)
  │
  ▼
buildImportValidationReport ──► semáforo estructural D-X17b (BLOCKED/NEEDS_ACKNOWLEDGMENT/OK)
buildExcelFinancialContrast  ──► semáforo financiero §113.7 (GREEN/YELLOW/RED)
detectWithinFileDuplicates   ──► duplicados por contenido D-X10 (dentro del archivo)
  │
  ▼
buildImportPreview ──► ImportPreview (todo lo anterior, combinado; función pura)
  │
  ▼
ImportUploadService.upload() ──► import_batches (UPLOADED) + import_rows (staging inmutable)
  │
  ▼
Resolución humana:
  ImportResolutionService.confirmHouse()      (D-X8; UPLOADED→VALIDATED o corrección)
  ImportResolutionService.saveStagePlan()     (D-X7; rangos de filas por etapa)
  ImportAcknowledgmentService.acknowledge()   (D-X17b; motivo)
  │
  ▼
ImportBetResolutionService.resolveBatch() ──► stageKey/stake + NormalizedImportBet[] final
findDuplicatesAgainstHistory()            ──► duplicados D-X10 contra lo ya importado de la casa
  │
  ▼
ImportConfirmationService.confirmBatch()
  ├─ backup reciente (D-X26) o ensayo declarado
  ├─ canConfirmImport() (bloqueo estructural + D-X17b + D-X10 + financiero)
  └─ assembleWriteInput() ──► ImportBatchWriteInput
       │
       ▼
     ImportWriterService.importBatch() [9.1.5, sin cambios] ──► ledger (financial_movements, bets, stages)
       → import_batches pasa a IMPORTED

ImportConfirmationService.annulBatch() ──► ImportWriterService.annulBatch() ──► ANNULLED,
  revierte el ledger con reversiones (histórico conservado, nunca se borra nada)
```

Endpoints HTTP (`/api/projects/:projectId/import-batches`): `POST /`, `GET /`, `GET /:id`,
`GET /:id/preview`, `POST /:id/house`, `POST /:id/stage-plan`, `POST /:id/acknowledge`,
`POST /:id/confirm`, `POST /:id/annul`, `GET /:id/file`. Detalle completo, decisiones y pruebas en
`docs/RESUMEN_FASE_9_3_CIERRE.md`.

## Pendiente para continuar

### Fase 9.4

- Frontend de importación (ninguna pantalla existe todavía):
  - pantalla de subida (archivo + origen);
  - pantallas de vista previa (resumen, filas con su semáforo y hallazgos, contraste financiero,
    duplicados D-X10);
  - resolución de etapas (editor del plan, con el rango de filas de cada una);
  - confirmación visual (reconocimiento con motivo, backup/ensayo, confirmación final, anulación).
  - Mismos patrones que el resto de la aplicación: `useReauth`/`runWithReauth`, `useLoad`,
    `stubApi` en pruebas.
- Ajuste de redacción del §113.6 ("vista previa ejecutada y revertida" ya no describe la
  arquitectura real desde la 9.2.6): documentado como pendiente, todavía sin aplicar.
- Inconsistencia documental de D-X23 en `apps/api/test/import-writer.e2e-spec.ts` (comentario y
  dato de prueba dicen "el día anterior a la primera apuesta"; el ADR y el código usan "el mismo
  día"). No es un defecto funcional; sigue pendiente un commit pequeño separado.

### Pendientes externos (no dependen de más código)

- **Archivo Betano real.** Sigue sin aparecer en ningún sitio de la máquina (búsqueda completa en
  la 9.2.0). `IMPORT_ORIGIN_ADAPTERS` (`apps/api/src/imports/parser/import-origin-registry.ts`)
  solo registra `"Betsafe"` hoy.
- **D-X7** (unidad y fronteras exactas de cada etapa): necesita tu aprobación explícita y
  contrastarla con un archivo real de Betano.
- **D-B8** (redondeo del retorno calculado): necesita retornos oficiales o tickets de Betsafe y/o
  Betano.
- **"Creada" (D-X24):** sin un ejemplo real que calibre su gramática de texto.

## Cómo continuar desde otro PC

```bash
git checkout fase-9.1/modelo-importacion
git pull            # si el remoto está configurado; esta rama no se ha publicado todavía
npm install
npm run db:start    # PostgreSQL local (embedded-postgres), bases letfer_dev y letfer_test
npm run db:migrate  # aplica 0001..0040 si la base es nueva
npm run check        # formato + lint + tipos + pruebas + build
```

Si `npm run check` falla solo en un `Hook timed out` de un archivo `src/database/migration-*.spec.ts`
o `import-batch-links-integrity.spec.ts`, vuelve a correr ese archivo solo — ver advertencias
abajo.

## Advertencias conocidas

- **No integrar a `main` todavía.** Toda la Fase 9 vive en `fase-9.1/modelo-importacion`, sin
  aprobación de integración.
- **No hacer `push`** si el remoto no está configurado en el nuevo entorno; comprobar con
  `git remote -v` antes de intentarlo.
- **Timeout ocasional en Windows** al soltar la base de datos de escenario de algunas pruebas
  (`Hook timed out in 60000ms` en `afterAll`, típicamente en `src/database/migration-from-phase1.spec.ts`,
  `src/database/migration-import-links.spec.ts` o `src/database/import-batch-links-integrity.spec.ts`).
  No es un defecto del código: pasa siempre al volver a correr ese archivo solo
  (`npx vitest run <archivo>` dentro de `apps/api`). Confirmado repetidas veces durante la Fase 9.
- **`pg_dump`/`pg_restore` no están instalados en este entorno de desarrollo.** Un backup manual
  (`BackupsService.createBackup`) queda en estado `FAILED` con `spawn pg_dump ENOENT`; es un
  comportamiento probado y esperado aquí, no un error. Las pruebas de backup reciente (D-X26)
  siembran el manifiesto directamente (`writeManifest`) en vez de depender de un backup real.
