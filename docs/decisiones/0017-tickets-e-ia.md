# 0017. Tickets e IA

- **Estado:** Aceptada (Fase 7)
- **Fecha:** 2026-09-24
- **Referencias:** especificación §28-§31, §36, §37, §41, §42, §44, §51-§53, §90, §97, §110

## Contexto

Con la Fase 5.5 cerrada (`v0.5.5-confianza-recuperacion`), toca la Fase 7 numerada (§67, §102):
tickets e IA. La especificación deja abiertas deliberadamente algunas decisiones ("Object
Storage" como categoría en §44, no un producto concreto; "el proveedor de IA se elegirá..." en
§97). Seis decisiones (D-T1 a D-T6) las tomó la persona responsable del producto; el resto de
este documento las precisa técnicamente.

## Decisiones funcionales (confirmadas)

- **D-T1.** Anthropic como proveedor inicial de IA, detrás de una interfaz `TicketReader`
  desacoplada (§52): la arquitectura no depende de Anthropic, solo la implementación actual.
- **D-T2.** Filesystem local inicialmente, detrás de una interfaz `FileStorage`; nunca
  archivos públicos, siempre servidos por la API autenticada; preparado para migrar a
  S3/R2/MinIO. Los tickets se incorporan al sistema de backups existente (Fase 5.5): ningún
  archivo queda fuera del respaldo completo.
- **D-T3.** JPG/JPEG/PNG/PDF (PDF multipágina permitido); máximo 10 MB por archivo; se valida
  extensión, tipo MIME real (no solo la extensión ni el `Content-Type` declarado) y tamaño.
- **D-T4.** El análisis por IA es una acción explícita ("Analizar con IA"), nunca automático al
  subir, para no generar costo sin que el usuario lo pida.
- **D-T5.** Comparación campo por campo (§31): actualizar / mantener / editar manualmente por
  campo, nunca aceptar o rechazar el ticket completo como única opción.
- **D-T6.** Confianza por campo visible en la interfaz (alta = normal, baja = resaltado), solo
  para ayudar a la revisión humana; nunca decide nada automáticamente (§30).

## Decisiones técnicas

### Sin vía financiera paralela (consideración adicional del usuario)

La IA nunca escribe en `bets`. `POST .../tickets/:id/analyze` solo devuelve una propuesta
(`TicketAnalysis`, contrato §53) en la respuesta HTTP; no se persiste como "aplicada" hasta que
el humano confirma. La confirmación reutiliza `POST .../bets` y `PATCH .../bets/:id` ya
existentes sin cambios de comportamiento: se les añade un campo opcional `ticketId` que,
cuando llega, vincula el ticket a la apuesta dentro de la misma transacción de `BetsService`
(nunca una escritura desde `tickets`/`ai`). Esto es deliberado: si el prellenado tuviera su
propio camino de escritura, se duplicarían las validaciones financieras de la Fase 4
(§51 — "no creará un segundo flujo financiero independiente").

### Contrato `TicketReader` (§52, §53)

```ts
interface TicketReader {
  analyze(input: { buffer: Buffer; mimeType: string }): Promise<TicketAnalysisResult>;
}
interface TicketAnalysisResult {
  provider: string;
  model: string;
  extraction: TicketExtraction; // exactamente el contrato conceptual del §53
  confidenceByField: Record<string, number> | null; // 0-1, D-T6
}
```

`AnthropicTicketReader` (módulo `ai/`) es la única implementación que conoce el SDK de
Anthropic; usa un modelo con visión y fuerza una salida estructurada (tool use con esquema
JSON) para no depender de parsear texto libre. `TicketsModule` depende del token
`TICKET_READER`, nunca de la clase concreta — cambiar de proveedor es sustituir el provider de
ese token.

### Contrato `FileStorage` (D-T2)

```ts
interface FileStorage {
  save(key: string, data: Buffer, contentType: string): Promise<{ sizeBytes: number; checksum: string }>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
```

`LocalFileStorage` guarda bajo `TICKETS_DIR/<projectId>/<ticketId>.<ext>`, reutilizando el
mismo endurecimiento de permisos que los backups (directorio `0700`, archivo `0600`,
`common/fs-security.ts` extraído de `backups/backup-files.ts` para que ambos lo compartan en
vez de duplicar la lógica de seguridad de archivos). Nunca hay una ruta pública: el único
acceso es `GET /projects/:id/tickets/:ticketId/file`, autenticado y verificando pertenencia al
proyecto igual que cualquier otra ruta (`@ProjectRoute`).

### Integración con backups (obligatoria en esta fase, no aplazable)

Cada generación de backup (`BackupsService.createBackup`) ahora también empaqueta
`TICKETS_DIR` completo con `tar` (mismo patrón que `pg_dump`/`pg_restore`: binario del sistema,
ruta configurable, D-B2 de la Fase 5.5) junto al volcado de PostgreSQL, y lo registra en la
misma entrada del manifiesto (`ticketsFileName`, `ticketsSizeBytes`, `ticketsChecksum`). Una
generación es `COMPLETED` solo si **ambas** partes (base de datos y archivos) tuvieron éxito: no
se acepta un backup que reconstruya la base pero no los archivos, ni viceversa (D-B2, "debe
poder reconstruir LetFer entero", ahora explícitamente extendido a que "entero" incluye los
tickets). `restore()` extrae el `tar` sobre `TICKETS_DIR` (reemplazando su contenido, mismo
espíritu que `--clean` en `pg_restore`) inmediatamente después del `pg_restore`, dentro del
mismo modo mantenimiento (M3, Fase 5.5) — si la extracción falla, la restauración completa se
reporta como fallida aunque la base ya se haya restaurado, para no dejar un estado a medias sin
avisar.

`tar` es un requisito nuevo en el entorno (igual que `pg_dump`/`pg_restore`), pero mucho más
ampliamente disponible por defecto (Linux, macOS y Windows 10+ lo traen preinstalado) que el
cliente de PostgreSQL: a diferencia de `pg_dump`, en el entorno de desarrollo usado para esta
fase sí está disponible, así que el round-trip completo de archivos (no solo de la base) tiene
prueba automatizada real.

### Límite de análisis IA (obligatorio, propuesto por Claude Code a falta de una cifra del usuario)

Sin límite, un usuario podría generar costo de IA sin acotar (reanálisis repetidos, o muchos
tickets el mismo día). Propuesta, configurable por variable de entorno:

- **Por ticket: máximo 5 análisis** (`AI_MAX_ANALYSES_PER_TICKET`, por defecto `5`). Permite
  reintentar tras una foto mal enfocada o mal recortada sin permitir un bucle indefinido.
- **Por proyecto: máximo 50 análisis en una ventana móvil de 24 h**
  (`AI_MAX_ANALYSES_PER_PROJECT_DAY`, por defecto `50`). Generoso para el uso diario esperado de
  un sistema personal de apuestas, pero acota el gasto máximo posible de un proyecto.

Ambos límites se verifican contando filas de `ticket_analyses` (histórico real, sin tabla de
contadores aparte — mismo principio que el resto del sistema: nada que pueda derivarse en
consulta se guarda como una segunda fuente de verdad). Al superarse cualquiera, la API responde
`429` con `ErrorCode.RATE_LIMITED` (código ya existente, reutilizado) y `retryAfterSeconds`
informativo. Un intento fallido de análisis (proveedor caído, imagen no procesable) **sí** se
registra y cuenta para el límite (evita que reintentos automáticos de un cliente mal
implementado lo eludan), con `status: 'FAILED'`.

### Nuevas tablas

- **`tickets`**: `id`, `projectId`, `betId` (nulo mientras no está vinculado a ninguna
  apuesta), `uploadedBy`, `storageKey`, `originalFileName`, `mimeType`, `sizeBytes`,
  `checksum`, timestamps, borrado lógico (mismo patrón que `bets`/`stages`/`projects`: eliminar
  no es esta fase — ver "Fuera de alcance").
- **`ticket_analyses`**: histórico de análisis de un ticket, **solo inserción** (mismo espíritu
  de inmutabilidad que `reconciliation_checkpoints`/`integrity_check_runs`, D2/D-C1): `id`,
  `ticketId`, `analyzedBy`, `analyzedAt`, `provider`, `model`, `status`
  (`COMPLETED`/`FAILED`), `errorMessage`, `extraction` (`jsonb`, contrato §53),
  `confidenceByField` (`jsonb`, nulo si el proveedor no lo entrega). `version` es la posición
  secuencial dentro del ticket (1º, 2º... análisis), no una fecha.

### Permisos nuevos

`tickets.view`, `tickets.upload`, `tickets.analyze` — mismo nivel que `bets.view`/`bets.create`
(Administrador de Proyecto y Colaborador; Lector solo `tickets.view`). Sin `tickets.delete` en
esta fase (ver "Fuera de alcance").

## Fuera de alcance (esta fase)

- **Eliminar un ticket de forma independiente.** Ni §28-§31 ni las decisiones del usuario lo
  piden; un ticket sigue el ciclo de vida de su apuesta (§36 — "tickets asociados siguen la
  misma retención"). Inventar una papelera propia para tickets sueltos habría sido una regla de
  negocio no aprobada (§68).
- **Migrar `FileStorage` a S3/R2/MinIO real.** La interfaz queda lista para ello (D-T2); el
  proveedor concreto se decide cuando corresponda (probablemente Fase 11, endurecimiento de
  producción, igual que PITR y almacenamiento cloud específico quedaron fuera de la Fase 5.5,
  §109).
- **Cambiar `betType` automáticamente según la IA.** Sigue §90: la IA propone, el backend valida
  contra la estructura real de selecciones, el humano confirma.

## Consecuencias

- `BackupsService` gana una responsabilidad más (archivar/restaurar `TICKETS_DIR`), pero
  mantiene su interfaz pública; el manifiesto sigue siendo la única fuente de verdad de qué
  generaciones existen (D-B3, Fase 5.5).
- Aparece `tar` como segundo binario externo requerido en el entorno (junto a
  `pg_dump`/`pg_restore`), con el mismo patrón de configuración por variable de entorno y de
  pruebas condicionadas a su disponibilidad.
- Cuando exista un proveedor de IA alternativo o un object storage real, sustituir
  `TICKET_READER`/`FILE_STORAGE` no debería tocar `TicketsController`, `BetsService` ni la web.
