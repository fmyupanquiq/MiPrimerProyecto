# Cierre de la Fase 9.4: interfaz web de la importación del historial

**Estado:** frontend completo y probado, con `npm run check` en verde. Sin integrar a `main`. Sin
`push`. Referencias: ADR 0020 (`docs/decisiones/0020-migracion-historial-excel.md`), §113 de la
especificación, `docs/PLAN_FASE_9_3.md`, `docs/RESUMEN_FASE_9_3_CIERRE.md`.

## 1. Objetivo

Dar a la importación histórica, ya completa en el backend desde la 9.3, una interfaz web con el
mismo recorrido que la API: subir el archivo, revisar la vista previa, resolver lo que solo una
persona puede resolver (casa, plan de etapas, reconocimientos) y confirmar o anular el lote. La
interfaz **solo presenta lo que devuelve la API**: no calcula semáforos, residuos, `stageKey`,
`stake` ni disponibilidad a confirmar, no crea etapas y no toca el ledger.

## 2. Subfases

| Subfase | Contenido |
|---|---|
| 9.4.0 | Contratos compartidos: `ImportPreview`, `ImportBatchSummaryRow`, `ImportBatchWriteResult`, `ImportBatchAnnulResult` pasan de `apps/api` a `@letfer/shared` (`import-preview.ts`, `import-batch.ts`). |
| 9.4.1 | Capa API de la web: `importsApi` (`apps/web/src/api/imports.ts`); `apiUpload` admite campos de formulario adicionales (`origin`). |
| 9.4.2 | Hooks: `useImportBatches.ts` (consultas con `useLoad`, mutaciones con estado de carga y error). |
| 9.4.3 | Rutas, pestaña "Importaciones" y páginas base (lista, subida, detalle). |
| 9.4.4 | Formulario de subida (origen + `.xlsx`, tamaño máximo) y redirección al lote creado. |
| 9.4.5 | Vista previa completa: resumen, estado estructural, contraste financiero, apuestas preliminares, duplicados. |
| 9.4.6 | Resolución humana: casa (D-X8) y plan de etapas (D-X7). |
| 9.4.7 | Reconocimiento (D-X17b), preparación de confirmación, confirmación y anulación; nuevo `GET /:id/readiness`. |
| 9.4.8 | Revisión final de la experiencia: refrescos, estados terminales, textos, duplicación entre paneles, pruebas de integración de página. |
| Cierre | `origin` fuera del esquema de confirmación, D-X23 en la prueba del escritor, documentación. |

## 3. Arquitectura frontend

```
App.tsx ── /projects/:projectId/imports            ImportsPage        (imports.view)
        ├─ /projects/:projectId/imports/new        ImportUploadPage   (import.run)
        └─ /projects/:projectId/imports/:batchId   ImportBatchPage    (imports.view)
                 │
                 ├─ resumen del lote (useImportBatch)
                 └─ ImportBatchWorkspace: carga una vez casas, vista previa y disponibilidad
                      ├─ HouseResolutionPanel      (ImportResolutionPanels.tsx)
                      ├─ StagePlanPanel            (ImportResolutionPanels.tsx)
                      ├─ AcknowledgmentPanel       (ImportConfirmationPanels.tsx)  ┐ solo con el lote
                      ├─ ConfirmationPanel         (ImportConfirmationPanels.tsx)  ┘ UPLOADED/VALIDATED
                      ├─ AnnulmentPanel            (ImportConfirmationPanels.tsx)    solo IMPORTED
                      └─ ImportPreviewSection      (ImportPreviewPanels.tsx)

páginas ──► hooks (useImportBatches.ts) ──► importsApi (api/imports.ts) ──► apiFetch/apiUpload ──► /api
```

- **Las páginas solo coordinan la interfaz.** Las llamadas viven en `importsApi` y los hooks; las
  reglas, en la API.
- **Una sola fuente por dato.** `ImportBatchWorkspace` pide casas, vista previa y disponibilidad una
  vez y las reparte a los paneles; tras cada acción actualiza el lote con la respuesta y vuelve a
  pedir solo lo que cambió:

  | Acción | Lote | Vista previa | Disponibilidad |
  |---|---|---|---|
  | Confirmar o corregir la casa | ✔️ (respuesta) | ✔️ (duplicados contra lo ya importado) | ✔️ |
  | Guardar el plan de etapas | ✔️ (respuesta) | — | — |
  | Reconocer | ✔️ (respuesta) | — | ✔️ |
  | Confirmar la importación | ✔️ (respuesta) | ✔️ | ✔️ |
  | Anular | ✔️ (respuesta) | ✔️ | ✔️ |

- **Permisos.** `ImportsGate` exige el setup completo del proyecto y el permiso de la pantalla antes
  de montar nada (sin permiso no se pide ningún dato). Dentro del detalle, los controles aparecen
  solo con `import.run` y en el estado que la API admite (`isBatchOpen`: `UPLOADED`/`VALIDATED`;
  anular, solo `IMPORTED`). Todo es mejora de la interfaz: la API vuelve a comprobarlo.
- **Reautenticación.** Reconocer, confirmar y anular usan `useReauth` dentro de sus hooks: si la API
  responde `REAUTH_REQUIRED`, se pide la contraseña y se reintenta; cancelar no se trata como error.
- **Avisos.** Un solo aviso de éxito por página (el de la última acción), como en `SettingsPage`; los
  errores se muestran junto a su formulario, con los motivos concretos que da la API
  (`details.issues`) cuando los hay (`ImportActionError`).
- **Piezas comunes** (`ImportsCommon.tsx`): rutas, `ImportsGate`, insignias de estado y de semáforo
  financiero, `isBatchOpen`, `apiIssues`, `ImportActionError`, `toIso`, lista de orígenes.

## 4. Páginas

- **`ImportsPage`** — lista de lotes (archivo, origen, estado, filas, fecha) con enlace al detalle;
  "Subir archivo" solo con `import.run`; estado vacío.
- **`ImportUploadPage`** — origen (hoy solo Betsafe) y archivo `.xlsx`. Antes de enviar solo
  comprueba extensión, archivo no vacío y el mismo límite de 10 MB que la API
  (`IMPORT_MAX_FILE_BYTES`); el contenido lo valida la API. Tras subir, abre el detalle del lote.
- **`ImportBatchPage`** — resumen del lote (estado, ensayo, origen, filas, fechas y motivos de
  importación y anulación), avisos de estado terminal y el área de trabajo:
  - **Casa del lote:** candidata de la API (del nombre del archivo) y casa confirmada; selector con
    la sugerencia de nombre idéntico, "Confirmar casa" / "Corregir casa".
  - **Plan de etapas:** candidatos de la vista previa (etiqueta, filas, evidencia); formulario que
    parte del plan guardado o de los candidatos (de ellos solo toma nombre y rango de filas; clave,
    unidad, fecha y estado los escribe la persona); los rechazos de la API se muestran por etapa y
    campo. Sin `import.run` o con el lote cerrado, tabla de solo lectura.
  - **Reconocimiento:** bloqueos y motivos que exigen reconocimiento, según `GET /readiness`; fecha y
    motivo del reconocimiento; formulario con motivo obligatorio.
  - **Confirmación:** resumen previo (estado, casa, plan, apuestas que entrarían, estado financiero,
    reconocimiento, si puede confirmarse), lista de lo que falta y un segundo paso que explica qué
    se registrará (apuestas, casa, etapas, capital inicial) antes de pedir el motivo y la marca de
    ensayo (D-X26).
  - **Anulación:** solo en lotes importados; confirmación previa con motivo obligatorio y botón de
    peligro.
  - **Vista previa:** resumen, estado estructural con sus hallazgos por fila, contraste financiero
    (semáforo, residuos exactos sin redondear, totales de cabecera, filas que difieren), apuestas
    preliminares con sus avisos y posibles duplicados.

## 5. Capa API y hooks

`importsApi` (`apps/web/src/api/imports.ts`): `list`, `get`, `upload`, `preview`, `readiness`,
`confirmHouse`, `saveStagePlan`, `acknowledge`, `confirm`, `annul`, `fileUrl`.

`useImportBatches.ts`:

| Hook | Tipo | Reautenticación |
|---|---|---|
| `useImportBatches`, `useImportBatch`, `useImportPreview`, `useImportReadiness` | consulta (`useLoad`) | — |
| `useUploadImportBatch`, `useConfirmImportHouse`, `useSaveImportStagePlan` | mutación | — |
| `useAcknowledgeImport`, `useConfirmImport`, `useAnnulImport` | mutación | ✔️ (`useReauth`) |

Las mutaciones exponen `loading` y `error` (ya descrito con `describeApiError`) y vuelven a lanzar el
error original, para que el panel lea `details.issues` o reaccione a un código concreto.

## 6. Cambios de backend en esta fase

Pequeños y acotados; ninguno toca el escritor ni el ledger:

- **`GET /:id/readiness`** (9.4.7, `imports.view`): expone `canConfirmImport()` tal cual
  (`blocked`, `blockingReasons`, `needsAcknowledgment`, `acknowledgmentReasons`, `acknowledged`,
  `financialSemaphore`, `canConfirm`). Es la misma comprobación que aplica `confirm`; solo lectura.
  Decisión del usuario: la web no deduce la disponibilidad desde la vista previa.
  `ImportConfirmationReadiness` pasa a `@letfer/shared`.
- **`origin` fuera de `confirmImportBatchSchema`** (cierre): la API lo leía del lote desde la 9.3.9 y
  lo ignoraba. Un cliente que aún lo envíe sigue funcionando (zod descarta las claves desconocidas;
  hay una prueba que lo comprueba). Se elimina `importOriginQuerySchema`, que no se usaba.
- **D-X23 en `import-writer.e2e-spec.ts`** (cierre, solo documental): el capital inicial de prueba
  pasa a las 00:00 del mismo día de la primera apuesta, como dicen el ADR y el código.

## 7. Flujo completo

1. **Subida** (`POST /`): el lote queda `UPLOADED`; la página abre el detalle con el aviso de que
   nada se registró todavía.
2. **Vista previa** (`GET /:id/preview`): se recalcula siempre desde el archivo conservado.
3. **Casa** (`POST /:id/house`): `UPLOADED → VALIDATED`; corregirla es repetible mientras siga
   `VALIDATED`.
4. **Plan de etapas** (`POST /:id/stage-plan`): repetible mientras el lote esté abierto; guardar no
   crea etapas.
5. **Reconocimiento** (`POST /:id/acknowledge`, reautenticación): solo si `GET /readiness` lo pide
   (filas parciales, rojo financiero, duplicados D-X10).
6. **Confirmación** (`POST /:id/confirm`, reautenticación): se ofrece activa cuando el lote está
   `VALIDATED`, tiene plan guardado y la API dice `canConfirm`; el backup reciente o la marca de
   ensayo los comprueba la API. `VALIDATED → IMPORTED`, atómico.
7. **Anulación** (`POST /:id/annul`, reautenticación): `IMPORTED → ANNULLED`; revierte con
   reversiones, sin borrar nada. `ANNULLED` es terminal.

## 8. Pruebas

Todas con `stubApi` (falla ante peticiones no previstas) y la aplicación completa (`renderApp`).

- **`ImportsPages.spec.tsx`** (44): navegación y pestaña; lista y estado vacío; setup incompleto y
  falta de permisos sin pedir datos; subida (éxito, sin archivo, extensión, tamaño, error de la
  API); detalle y vista previa (carga, bloqueado, advertencias, contraste sin configurar, error de
  la API, lote inexistente o de otro proyecto); casa (confirmar, corregir, error); plan (guardar,
  rechazo con motivos, error de esquema por etapa y campo); reconocimiento (correcto, rechazado);
  confirmación (bloqueada por falta de reconocimiento, rechazo con motivos, con reautenticación,
  exitosa); anulación (exitosa, con error); permisos por rol.
- **Integración de página** (dentro del mismo archivo): una API simulada con estado recorre subida →
  casa → plan → reconocimiento con reautenticación → confirmación → anulación, y comprueba en cada
  paso el estado del lote, los avisos, los botones activos y cuántas veces se pidieron la vista
  previa y la disponibilidad; lote anulado terminal; `imports.view` sin `import.run`, `import.run`
  con `imports.view` y sin acceso al proyecto.
- **`useImportBatches.spec.ts`** (3) y **`client.spec.ts`** (subida con campos adicionales).
- **API**: `import-batches.e2e-spec.ts` suma 4 pruebas de `GET /readiness` (lote limpio, duplicado
  antes y después de reconocer, fila inválida que bloquea aunque se reconozca, permisos y 404) y
  la confirmación sin `origin` (y con un `origin` antiguo, que se descarta).

Resultado de `npm run check` al cerrar: `shared` 133, `api` 1186 (+2 omitidas conocidas), `web` 315;
formato, lint, tipos y build en verde.

## 9. Pendientes conocidos

- **Fechas del plan de etapas en la hora del navegador.** La fecha de inicio se escribe y se muestra
  en la zona del navegador, no en la del proyecto. Es el mismo criterio que ya siguen Apuestas y las
  correcciones: si se cambia, debe ser para toda la aplicación (Fase 10).
- **`ImportBatchSummaryRow` declara sus fechas como `Date`,** pero por HTTP llegan como cadenas; la
  web lo resuelve con `toIso`. Corregir el tipo exigiría serializar en la API (el servicio devuelve
  filas de Drizzle con `Date`); no compensa hacerlo solo por limpieza.
- **`readiness` no incluye el plan de etapas ni el estado del lote.** Es correcto por diseño:
  refleja exactamente `canConfirmImport()` (bloqueo, reconocimiento, financiero, duplicados), que es
  lo que `confirm` comprueba **antes** de resolver el plan. La web comprueba además, con datos del
  propio lote, que esté `VALIDATED` y tenga plan guardado; que el plan cubra todas las filas lo
  valida solo la API al confirmar (400 con las filas sin cubrir, que la web muestra).
- **Quién reconoció, importó o anuló:** la API solo da el identificador de la persona; la web muestra
  fecha y motivo.
- **Lista de orígenes duplicada en la web** (`IMPORT_ORIGIN_OPTIONS = ['Betsafe']`): al registrar un
  segundo adaptador en la API habrá que añadirlo también aquí (o exponer la lista desde la API).
- Heredados de la 9.3, sin cambios: **D-X7** y **D-B8** sin decidir, **archivo real de Betano**
  ausente, **"Creada" (D-X24)** sin ejemplo real, y el **ajuste de redacción del §113.6** (requiere
  aprobación para tocar la especificación).
