# Plan de la Fase 9.3: de `ImportPreview` a una importación confirmable

**Estado:** propuesta de diseño, sin código todavía. Referencias: ADR 0020
(`docs/decisiones/0020-migracion-historial-excel.md`), §113 de la especificación, cierre de la
Fase 9.2 (`docs/RESUMEN_FASE_9_2_CIERRE.md`).

**Objetivo de la Fase 9.3:** convertir un `ImportPreview` en una importación confirmable mediante
intervención humana, sin perder trazabilidad.

**Principio que separa la 9.2 de la 9.3 (confirmado):**

- **9.2 — Preview:** calcula qué ocurriría, sin ningún efecto secundario, en memoria, y puede
  repetirse sin límite. **No se modifica su diseño.**
- **9.3 — Confirmation:** persiste el análisis como una fotografía inmutable (staging), deja que
  una persona resuelva lo que solo una persona puede resolver (D-X7, D-X17b, D-X26) y, solo
  entonces, entrega datos ya completos al escritor.
- **Writer (9.1.5, sin cambios):** recibe datos confirmados, escribe el ledger, crea los efectos
  reales.

Preview y Writer **comparten las mismas reglas de negocio** (el mismo motor de normalización, el
mismo cálculo de retorno, el mismo D-X24, D-X15…), pero ya no ejecutan el mismo camino de código en
la misma petición: es una arquitectura más simple que la que describe el §113.6 hoy.

## Ajuste de especificación pendiente (documentar, no aplicar todavía)

El §113.6 dice: *"vista previa (mismo código que la escritura, ejecutado y revertido, como en
8.5.3)"*. Esa frase describe un acoplamiento mayor del que la 9.2 terminó necesitando: `ImportPreview`
no ejecuta ni revierte nada, es una función pura sobre datos ya normalizados. **Pendiente:**
corregir esa frase del §113.6 para que diga que Preview y Writer comparten las reglas de negocio del
motor de normalización, no la misma ruta de ejecución. Se hace en un commit de documentación,
después de que el código de la 9.3 esté aprobado y funcionando (para describir lo que de verdad se
construyó, no una intención).

## 1. Máquina de estados del `ImportBatch`

**Se mantienen los cuatro estados existentes; no se crea ninguno nuevo.**

```
UPLOADED ──────────────► VALIDATED ──────────────► IMPORTED ──────────────► ANNULLED
   │  (POST /house:          │  (POST /confirm:          (POST /annul)
   │   houseId + valida-     │   atómica; llama al
   │   tedAt/By en el        │   escritor 9.1.5)
   │   mismo paso)           │
   │                          │
   └── se puede repetir       ├── POST /stage-plan (repetible)
       la subida (otro         ├── POST /acknowledge (si hace falta)
       archivo, nuevo lote)    └── GET /preview (repetible, sin efectos)
```

`VALIDATED` es, tal como se confirmó, **"lote preparado para importar"**: un estado más largo y
progresivo, no un paso intermedio de un solo instante. Mientras el lote está `VALIDATED` puede
recibir, en cualquier orden y cualquier número de veces (el disparador `import_batches_guard` ya lo
permite, migración 0033):

- `house_id` ya confirmado (se fija al entrar a `VALIDATED`, pero nada impide que un lote futuro
  permita corregirlo mientras siga en este estado — **decisión abierta**, ver §5 de este documento).
- `stage_plan` resuelto (y puede revisarse varias veces antes de confirmar).
- Los reconocimientos de D-X17b, si hacen falta.
- Los contadores de filas (`rows_total`, `rows_valid`, …), que se recalculan cada vez que se sube o
  se vuelve a analizar el archivo.

**La transición a `IMPORTED` es atómica**: una sola operación (`POST /:id/confirm`), dentro de una
transacción, que comprueba TODO lo anterior y solo entonces llama al escritor de la 9.1.5 (que ya
mueve el estado y escribe el ledger en su propia transacción). Nada queda a medias: si el escritor
falla, el lote sigue en `VALIDATED`.

## 2. Esquema de persistencia del staging

**`import_rows` no necesita ninguna columna nueva.** Ya tiene, desde la 9.1.2a, exactamente lo que
pide esta fase:

| Columna | Contenido |
|---|---|
| `raw_values` | Valores originales de la fila (D-X12) |
| `normalized` | Lo que el normalizador de la 9.2 entendió de la fila (solo si es `VALID`) |
| `status` | `VALID` / `TEMPLATE` / `EMPTY` / `PARTIAL` / `INVALID` — el mismo `RowClassification` de la 9.2, sin traducir |
| `findings` | Los hallazgos del clasificador (9.2.1), tal cual |
| `traffic_light` | El semáforo **financiero** por fila (GREEN/RED de `excel-financial-contrast.ts`, §113.7); `NULL` en una fila que no es `VALID` |
| `created_bet_id` | Vacío hasta que el escritor cree la apuesta (D-X10, D-X25) |

**`import_batches` necesita tres columnas nuevas** para los reconocimientos (§4) y ninguna otra:
`acknowledgment_reason`, `acknowledged_by`, `acknowledged_at`.

**El staging es una fotografía inmutable del análisis** (tal como se pidió): se escribe una vez, al
subir el archivo (o al volver a analizarlo, si eso se permite — ver §5), y no cambia salvo
`created_bet_id`, que lo completa el escritor al confirmar. Nunca se reescribe para "corregir" una
fila: si el archivo estaba mal, se anula el lote (si ya se importó) o se sube uno nuevo (D-X10 ya
contempla reimportar tras anular).

**Qué no se persiste en `import_rows` y por qué:** el resto de `ImportPreview` (candidatos de
etapa, contraste financiero por fila y total, resumen) se **recalcula** cada vez que se pide (`GET
/preview`), a partir de `source_file` (ya guardado) y de lo que el lote ya tiene confirmado
(`house_id`, `stage_plan`). No hay una segunda copia de esa información que pueda desincronizarse
del archivo original.

## 3. Contrato entre Preview → Confirmation → Writer

```
9.2 (sin cambios)                 9.3 (nuevo)                              9.1.5 (sin cambios)
──────────────────                ───────────                              ───────────────────
readWorkbook()          ┐
normalizeImportSheet()  │
buildImportValidation-  ├─► ImportPreview ──► persistir import_rows        ImportWriterService
  Report()              │   (función pura,     (al subir)                  .importBatch()
buildExcelFinancial-    │    en memoria)
  Contrast()            │                    ──► plan de etapas humano
buildImportPreview()    ┘                        (POST /stage-plan) ──►
                                                  resolver stageKey/stake
                                                  por apuesta preliminar
                                                                        ──► ImportBatchWriteInput
                                                                             (stages + capital +
                                                                              bets, ya completos)
```

**Lo que la 9.3 tiene que construir para completar el contrato:**

1. Un **orquestador** (no existe todavía) que, dado el `Buffer` guardado en `source_file` y un
   `ImportOriginAdapter`, ejecuta los cinco pasos de la 9.2 y devuelve el `ImportPreview`. Se llama
   al subir y cada vez que se pide `GET /preview`.
2. Un **paso de persistencia del staging**: de `ImportNormalizationResult.rows` (más el semáforo
   financiero de cada apuesta) a filas de `import_rows`.
3. Un **resolutor de etapas**: dado el `stage_plan` que confirmó la persona (una lista de etapas
   reales, cada una con el rango de filas que le corresponde) y las apuestas preliminares, calcula
   `stageKey` (a qué etapa pertenece cada fila) y `stake` (`monto ÷ unidad de esa etapa`, D-X19).
   Es la única pieza nueva de cálculo de negocio de la 9.3; todo lo demás ya existe.
4. Un **verificador de reconocimientos**: antes de confirmar, comprueba que si el semáforo
   estructural es `NEEDS_ACKNOWLEDGMENT` o el financiero es `RED`, existe un reconocimiento
   guardado (D-X17b). Amarillo nunca lo exige (es solo informativo).

## 4. Reconocimientos (D-X17b)

**Separados del motivo de la acción del lote, como se pidió:**

| Para qué | Columnas |
|---|---|
| Reconocer un semáforo rojo o una fila parcial | `acknowledgment_reason`, `acknowledged_by`, `acknowledged_at` |
| Confirmar la importación | `import_reason`, `imported_by`, `imported_at` (ya existen) |
| Anular el lote | `annulment_reason`, `annulled_by`, `annulled_at` (ya existen) |

Un lote sin nada que reconocer (semáforo `OK` y financiero `GREEN`/`YELLOW`) puede confirmarse sin
haber llamado nunca a `POST /:id/acknowledge`; los tres campos quedan `NULL`. Si hace falta y no se
llamó, `POST /:id/confirm` lo rechaza (409, con el detalle de qué falta reconocer).

## 5. Endpoints definitivos

Bajo `/api/projects/:projectId/import-batches`, alcance de proyecto:

| Ruta | Método | Permiso | Efecto |
|---|---|---|---|
| `/` | POST | `import.run` | Sube el archivo, corre el pipeline, persiste `import_rows`, crea el lote `UPLOADED` |
| `/` | GET | `imports.view` | Lista los lotes del proyecto |
| `/:id` | GET | `imports.view` | Detalle y estado del lote |
| `/:id/preview` | GET | `imports.view` | Recalcula y devuelve el `ImportPreview` completo |
| `/:id/house` | POST | `import.run` | Confirma o corrige la casa; `UPLOADED → VALIDATED` la primera vez, repetible mientras siga `VALIDATED` (ver regla abajo) |
| `/:id/stage-plan` | POST | `import.run` | Guarda o revisa el plan de etapas (repetible mientras esté `VALIDATED`) |
| `/:id/acknowledge` | POST | `import.run` + reauth | Registra el reconocimiento de D-X17b, con motivo |
| `/:id/confirm` | POST | `import.run` + reauth | Comprueba casa, etapas, reconocimientos y backup/ensayo; llama al escritor; `VALIDATED → IMPORTED`, atómico |
| `/:id/annul` | POST | `import.run` + reauth | Llama a la anulación; `IMPORTED → ANNULLED` |
| `/:id/file` | GET | `imports.view` | (opcional) descarga el archivo original |

**Cambio respecto a la propuesta anterior:** no hay un `/validate` separado. Confirmar la casa
**es** lo que mueve el lote a `VALIDATED`, porque el propio esquema ata las dos cosas (`house_id`
obligatorio desde `VALIDATED`); un endpoint aparte que "valide todo" no tendría nada distinto que
hacer.

**Regla de `POST /:id/house` (resuelta):**

| Estado del lote | Efecto |
|---|---|
| `UPLOADED` | Permitido: confirma la casa y mueve `UPLOADED → VALIDATED`. |
| `VALIDATED` | Permitido: corrige la casa ya confirmada (una selección equivocada), sin cambiar el estado. |
| `IMPORTED` o `ANNULLED` | Rechazado (409). |

Mientras el lote está preparado pero no importado, la persona puede corregir una casa mal elegida;
una vez que se escribió al ledger, la casa queda inmutable como el resto del lote (mismo espíritu
que el disparador `import_batches_guard`, migración 0033).

## 6. Responsabilidades

**Backend (nuevo en la 9.3):**
- El orquestador del pipeline (lectura + los cinco pasos de la 9.2).
- Persistencia de `import_rows` desde el resultado del pipeline.
- El resolutor de `stageKey`/`stake` a partir del plan de etapas confirmado.
- Los nueve endpoints de la tabla anterior.
- La comprobación de backup reciente o ensayo declarado (D-X26) y de los reconocimientos (D-X17b)
  dentro de `POST /confirm`.

**Backend (sin cambios, ya existe):** el modelo de datos, los permisos y la auditoría (9.1.3), las
guardas de un lote anulado (9.1.4), y el escritor con su anulación (9.1.5).

**Frontend (nuevo en la 9.3):** pantalla de subida; tabla de filas con su categoría/semáforo y
hallazgos; editor del plan de etapas; panel de contraste financiero (siguiendo el patrón de
`BetFinancialPanels.tsx`); diálogo de reconocimiento con motivo + `useReauth`/`runWithReauth`;
confirmación final y pantalla de resultado o anulación. Con `useLoad` y `stubApi`, como el resto de
la aplicación.

## 7. Campos nuevos necesarios (resumen)

- **`import_batches`**: `acknowledgment_reason` (texto, nulo), `acknowledged_by` (uuid, nulo, FK a
  `users`), `acknowledged_at` (timestamptz, nulo). Migración siguiente a la 0036 (sería la 0037).
- **`import_rows`**: ninguno.
- Reglas de forma a añadir en la migración personalizada de disparadores (mismo patrón que
  `import_batches_guard`, migración 0033): los tres campos de reconocimiento deben estar los tres
  presentes o los tres ausentes (igual que ya exigen `annulled_at`/`annulled_by`/`annulment_reason`
  entre sí).

## 8. Orden de commits propuesto (a revisar, no definitivo)

1. **9.3.1** — Migración: columnas de reconocimiento en `import_batches`, con su regla de forma.
2. **9.3.2** — Orquestador del pipeline (lectura del archivo guardado + los cinco pasos de la 9.2)
   y persistencia de `import_rows`. Sin endpoint todavía; solo el servicio y sus pruebas.
3. **9.3.3** — Resolutor de `stageKey`/`stake` a partir de un plan de etapas ya confirmado. Sin
   endpoint todavía.
4. **9.3.4** — Endpoints de subida, listado, detalle y vista previa (`POST /`, `GET /`, `GET /:id`,
   `GET /:id/preview`).
5. **9.3.5** — Endpoint de casa (`POST /:id/house`) y de plan de etapas (`POST /:id/stage-plan`).
6. **9.3.6** — Endpoint de reconocimiento (`POST /:id/acknowledge`).
7. **9.3.7** — Endpoint de confirmación (`POST /:id/confirm`, llama al escritor) y de anulación
   (`POST /:id/annul`).
8. **9.3.8** — Revisión final de la subfase (permisos, auditoría, concurrencia, invariante) antes
   de la interfaz web.

La interfaz web (frontend) y el ajuste de redacción del §113.6 quedan para después de que el
backend de la 9.3 esté aprobado.

## Fuera de alcance de este documento

- No se decide el contenido exacto de `stage_plan` (forma del JSON) — se define en el commit 9.3.3.
- No se toca el ADR 0020 ni la especificación en este documento; el ajuste de §113.6 queda anotado
  como pendiente (sección "Ajuste de especificación pendiente").
