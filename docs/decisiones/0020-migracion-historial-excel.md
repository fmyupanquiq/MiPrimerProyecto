# 0020. Migración del historial de apuestas desde Excel

- **Estado:** Aceptada para iniciar la Fase 9.1 (subfase 9.0 cerrada en lo documental). Quedan pendientes
  únicamente **D-X7** (unidad y fronteras exactas de las etapas) y **D-B8** (redondeo). Aún no hay código
  ni migraciones de la Fase 9.
- **Fecha:** 2026-09-26
- **Referencias:** especificación §11, §12, §16, §26, §36, §37, §55, §65, §71, §72, §75, §76, §77, §82,
  §88, §90, §93, §94, §107, §108, §109, §112; §113 de la especificación (`docs/ESPECIFICACION_LETFER_V1_1.md`);
  ADR 0004, 0013, 0014, 0017, 0019; resumen en
  `docs/RESUMEN_FASE_9_0.md`.

## Contexto

Con la Fase 8.5 cerrada (`v0.8.5-correcciones-financieras`), el modelo puede recibir historia: el ledger
es inmutable y reversible, las liquidaciones admiten retorno provisional o confirmado, las correcciones
son controladas y la verificación de integridad y el dashboard salen del ledger. La Fase 9 (§65, §67)
absorbe el historial que hoy vive en Excel: **Excel → lectura → transformación → validación → vista previa
→ importación → verificación**, nunca a ciegas.

## Principio rector

**No se migra un sistema financiero ni se replica el Excel: se absorbe un registro histórico de apuestas
dentro del modelo LetFer.** El Excel es una fuente histórica, no la fuente de verdad financiera. Las cifras
que calcula (A+G, GANANCIA, Bank Actual, contadores, porcentajes, META) son derivadas y **no se importan**:
LetFer las recalcula con sus reglas y las conserva solo como control informativo. Nunca se ajusta ni se
fuerza nada para que coincidan.

## Hallazgos del Excel de Betsafe (análisis real, sin importar nada)

Archivo `Betsafe.xlsx`, hojas `Rondas` (datos), `Balances` (resúmenes derivados) y `No Modificar`
(listas de las opciones desplegables).

- Una tabla de 158 filas numeradas (N°, FECHA, DEPORTE, PARTIDO, TIPO, APUESTA, CUOTA, RESULTADO, A+G,
  GANANCIA) con **solo 6 apuestas reales** (4 ganadas, 2 perdidas); el resto es plantilla con fecha y
  deporte prellenados.
- Cabecera: Bank Inicial 1000 (sin fecha), Bank Actual 1271.755, Apostado 937.5, META 20000.
- La casa **no es una columna**: es el nombre del archivo. Hay 2 casas (un archivo por casa, mismas
  columnas); LetFer conserva la arquitectura multi-casa.
- Las "rondas" del Excel son las **etapas** de LetFer. La hoja solo tiene el encabezado `RONDA 1`;
  `Balances` suma bloques de 10 apuestas cada 13 filas numeradas.
- FECHA es solo fecha (2024-10-22 en todas las filas, incluidas las vacías): sin hora ni fecha de
  liquidación. Los montos son múltiplos de 12.5 (posible unidad de la etapa). Las cuotas de simples tienen
  dos decimales; la de un múltiple, seis (1.510016: producto de las cuotas de cada selección).
- TIPO: Simple, Multi (la lista también admite Creada). RESULTADO: GANADO, PERDIDO, PENDIENTE; en blanco,
  la fila vale 0.
- PARTIDO es texto libre; en un múltiple cada selección empieza con `*` y una línea `Equipo vs Equipo:`.
- **A+G y GANANCIA son cálculos de Excel** (`monto × cuota` sin redondear), no datos oficiales de la casa.
- No hay depósitos, retiros ni transferencias; no hay cash out en lo revisado (el sistema lo mantiene).
- No hay identificador, hora, autor, ticket ni columna de casa. Los números se guardan como binarios de
  coma flotante (`243.00000000000003`).
- 62.5 × 1.75 = 109.375 es un empate exacto de medio céntimo: con `ROUND_HALF_UP` el saldo de LetFer sería
  1271.76 y con truncado 1271.75, mientras el Excel dice 1271.755.

## Hallazgos adicionales (subfase 9.2.0): fórmulas, listas y estilos de Betsafe

Mismo archivo, analizado ahora a nivel de XML crudo (fórmulas, validaciones de datos y formatos de celda),
sin escribir ningún lector todavía. `Betano.xlsx` sigue sin aparecer en la máquina (se buscó en todo el
perfil del usuario): todo lo de aquí es solo de Betsafe.

- **Las listas desplegables son la autoridad, no un texto libre parecido.** Las validaciones de datos
  (`x14:dataValidation`, en el `extLst` del XML) fijan rangos exactos de `No Modificar`:
  `RESULTADO` → `$E$4:$E$6` (GANADO, PERDIDO, PENDIENTE: **ninguna otra opción existe en el desplegable**,
  ni ANULADA ni CASH OUT); `TIPO` → `$D$4:$D$6` (Simple, Multi, Creada); `DEPORTE` → `$F$4:$F$5` (FUTBOL,
  TENIS); el año de la cabecera → `$B$4:$B$14` (2024–2034). Hay también una lista `Mes` (`C4:C15`,
  Enero–Diciembre) que **no está enlazada a ninguna validación**: es un resto sin uso del formato.
- **Gramática exacta de un múltiple en PARTIDO.** Cada selección es un bloque `*Evento:\r\nSelección`, y
  los bloques se separan por una línea en blanco (`\r\n\r\n`); una Simple no lleva `*`. Ejemplo real (fila 14):
  `"*Manchester City vs Southampton:\r\nGana Manchester City\r\n\r\n*Napoli vs Lecce:\r\nGana Napoli\r\n"`.
  Ningún registro usa "Creada": su forma de texto sigue sin un ejemplo real que la calibre.
- **La cantidad de decimales de CUOTA no distingue el tipo.** La fila 11 es un múltiple de 2 selecciones
  con cuota `1.75` (2 decimales, no el producto exacto de sus cuotas): confirma que D-X24 debe derivar el
  tipo del texto de PARTIDO, nunca de cuántos decimales tiene la cuota.
- **Formatos de celda (solo de presentación; el valor crudo que se lee es siempre el mismo).** FECHA usa
  el formato de fecha corta nativo de Excel (`numFmtId 14`, sin hora): confirma que ninguna hora se guardó
  nunca ahí. APUESTA y A+G usan un formato moneda `"S/. #,##0.00"`. CUOTA no tiene formato fijo en la
  mayoría de filas (columna "General"); en 3 filas del múltiple sí tiene un formato `"0.00"`, que solo
  afecta a cómo Excel lo muestra, no al valor almacenado (`1.510016` sigue teniendo sus 6 decimales).
- **Revisión importante de D-X7: la frontera entre rondas depende de la posición, no de un rótulo.** Cada
  columna `RONDA n` de `Balances` está cableada por posición a un bloque fijo de 13 filas de `Rondas` (3 de
  cabecera + 10 de apuestas): Ronda 1 → filas 11-20, Ronda 2 → 24-33, Ronda 3 → 37-46, … Ronda 10 → 128-137
  (paso de 13). En este archivo solo la Ronda 1 tiene un rótulo `"RONDA 1"` (fila 8) y datos reales (filas
  11-16); las filas 17-168 son plantilla continua — el N° sigue subiendo de 7 a 158 sin que nunca se
  insertara un rótulo `"RONDA 2"` ni una cabecera de columnas nueva. `Balances` da cero en esas columnas
  simplemente porque esas filas están vacías, no porque exista una ronda 2 real. **El parser no puede
  confiar en encontrar el texto `"RONDA n"` para saber dónde empieza cada ronda**: en este archivo la única
  frontera visible es la de la Ronda 1: sigue sin saberse si Betano marca sus rondas con rótulo o solo por
  posición. D-X7 sigue pendiente por esto, además de la unidad.
- **Precisión de D-X7 (9.2.1).** El parser **nunca convierte automáticamente un bloque visual del Excel en
  una etapa definitiva**: solo genera **candidatos de etapa con evidencia** (el rótulo encontrado, la fila
  donde está, el rango de filas que agrupa y por qué). Confirmar, ajustar o dividir esos candidatos en
  etapas reales queda para la validación previa (con una persona, en la 9.3), nunca para una regla automática
  del lector.
- **Hipótesis de unidad (D-X7, sin cerrar).** Los 6 montos reales (62.5, 75, 87.5, 312.5, 250, 150) son
  múltiplos exactos de **12.5**, con stakes enteros (5, 6, 7, 25, 20, 12). Es la misma hipótesis del primer
  análisis, ahora reconfirmada; falta tu confirmación y contrastarla con Betano.
- Sin comentarios, hipervínculos ni notas ocultas; dos imágenes decorativas (`image1.png`, `image2.jpeg`)
  sin datos. Las fórmulas de la cabecera (Apostado, Ganancia, Ganados/Perdidos/Pendientes, % de acierto,
  progreso hacia la meta) quedaron confirmadas exactamente; ninguna se importa (principio rector).

## Decisiones cerradas

**Alcance y contexto**

- **D-X1.** La primera importación se hace en un **proyecto de ensayo separado**, nunca sobre uno operativo.
  Además se aplica una guardia técnica (ver "Proyecto apto").
- **D-X2.** Vía especial de movimientos históricos con fecha explícita, `batch_id` y permiso `import.run`.
- **D-X3 y D-X18.** **Bank Inicial se convierte en un `INITIAL_CAPITAL` histórico del ledger** (uno por casa),
  fechado antes de la primera apuesta de esa casa y con fecha desconocida (`occurred_at_known = false`, D-X29):
  no se inventa una fecha oficial. Su etapa es la de la primera ronda.
- **D-X4.** Los retornos que provienen del Excel son **provisionales**, salvo evidencia de que vienen de la
  casa. Una ganada se liquida con el retorno calculado por LetFer (`calculateBetReturn`); el A+G del Excel
  queda solo como control.
- **D-X6.** El Excel no tiene transferencias; anular un lote solo revierte capital inicial, apuestas y etapas
  del lote. Queda documentado que `REVERSAL` no revierte `TRANSFER`.
- **D-X8.** **La casa sale del nombre del archivo.** Se normaliza, se asocia a una casa existente del proyecto y
  se confirma en la vista previa; una casa desconocida no se crea en silencio.
- **D-X9.** Autor de las apuestas: quien ejecuta la importación, salvo columna fiable de autor.
- **D-X13.** Sin selecciones desglosadas: se importa con la descripción histórica.
- **D-X15.** Las **apuestas múltiples importadas conservan únicamente la cuota total visible y el texto de las
  selecciones**. No se exigen cuotas individuales.

**Datos y fechas**

- **D-X5 y D-X23.** Sin hora exacta: `placed_time_known = false` y un instante técnico que no se usa para inventar
  orden entre apuestas. Instantes técnicos: una fecha sin hora es **12:00 en la zona del proyecto**; el capital
  inicial de una casa es **00:00 de la fecha de su primera apuesta** (siempre anterior). Si una importación
  posterior añade apuestas anteriores al capital, la validación la rechaza y hay que anular el lote anterior.
- **D-X20.** Sin fecha de liquidación: `settled_at = placed_at` con `settled_time_known = false`.
- **D-X16.** Orden de las apuestas de un mismo día: N° solo como desempate técnico (nunca evidencia de tiempo).
  El validador agrupa por instante y, además, avisa en amarillo si en el peor orden (todas las colocaciones
  antes que las liquidaciones) el saldo de la casa quedaría negativo.
- **D-X19.** El stake se calcula como `monto / unidad de la etapa` y es **informativo**: el ledger usa el monto
  del Excel como monto oficial no confirmado (`official_amount` con `amount_confirmed = false`). Si no es un
  múltiplo exacto, se avisa en amarillo; no bloquea.
- **D-X24.** Tipo derivado del texto (§90): cada bloque `*` es un evento y, sin `*`, es uno solo. Si el tipo
  derivado difiere del declarado (Simple, Multi, Creada), se avisa en amarillo y el tipo declarado se conserva en
  el informe. La calibración del analizador con textos reales de Betano se hace en la 9.2 y no reabre la decisión.

**Filas y lectura**

- **D-X21 y D-X21b.** Cada fila se clasifica: **plantilla o vacía** (sin monto, cuota, resultado ni descripción),
  se ignora y se cuenta; **parcial** (algún dato pero no todos los obligatorios: fecha, monto, cuota y resultado), no
  se importa y se reporta en amarillo como "requiere revisión"; **válida**. Nunca se pierde una fila con datos en
  silencio.
- **D-X10.** Identidad de una fila: huella `sha256` del archivo más su N°. Además se buscan duplicados por
  contenido (fecha, descripción, monto, cuota), tanto dentro del archivo como contra las apuestas ya importadas de
  esa casa, y **se reportan sin descartar nada solos**.
- **D-X12.** Solo `.xlsx`, con un lector que exponga los valores exactos como texto (el archivo trae ruido de coma
  flotante); la librería se elige y se fija sin `^` al empezar la 9.2. Se conserva el archivo original (D-X26).
- **D-X14.** Escala pequeña (decenas o cientos de apuestas por casa): sin optimización previa; la validación se
  hace sobre el lote completo.

**Semáforo y confirmación**

- **D-X11 y D-X17.** Las diferencias Excel frente a LetFer son informativas, con semáforo; nunca hay ajustes
  automáticos (ver sección siguiente).
- **D-X17b.** Se distinguen **errores que bloquean** de **avisos que exigen reconocimiento**:
  - Bloquean: columnas obligatorias ausentes, casa desconocida, resultado desconocido, monto o cuota no positivos o no
    numéricos, fecha inválida, plan de etapas incompleto, secuencia imposible (saldo negativo), archivo ya
    importado y proyecto no apto.
  - Semáforo **rojo** y filas **parciales**: no bloquean, pero para confirmar exigen un reconocimiento explícito con
    motivo (además de la reautenticación); queda en el informe y en la auditoría.
  - Semáforo verde y avisos amarillos: solo informan.

**Modelo, escritura y anulación**

- **D-X22.** Proyecto de ensayo: se configura con el setup existente, con las casas en `0` (el setup ya admite un
  saldo inicial de cero y no crea movimiento) y la unidad de la primera ronda. El capital entra por la vía histórica.
  No requiere cambios de código.
- **D-X25.** Una apuesta anulada por su lote queda **eliminada lógicamente con el motivo fijo "Lote anulado"** y
  **no puede restaurarse individualmente**: `restore` y `restoreSettled` responden 409 si pertenece a un lote
  anulado, y la papelera del proyecto no la lista.
- **D-X26.** El **archivo original se conserva dentro del sistema** (`bytea` en `import_batches`, con `sha256` y
  límite de 10 MB; uno mayor se rechaza antes del staging), de modo que entra en los backups y en la restauración. Antes de confirmar una importación
  real es **obligatorio un backup reciente** (generado en las últimas 24 horas). Un ensayo puede declararse como tal
  al confirmar (con motivo, queda en el lote y auditado) y queda exento de esa exigencia.
- **D-X27.** La importación usa un **escritor propio**: no reutiliza `BetsService.create/settle` (comprueban el
  disponible de hoy, exigen etapa activa, auditan por apuesta e invalidan checkpoints). Genera las filas con el motor
  financiero (`desiredBetLedgerLines`, `applyBetLedgerPlan`) y valida la **línea de tiempo completa del lote**
  antes de confirmar la transacción.
- **D-X28.** Las etapas históricas admiten `starts_at` y `batch_id`. `starts_at` (opcional) sirve a los marcadores
  del gráfico de banca, que hoy usan `created_at`; `batch_id` permite anular las etapas que creó un lote.
- **D-X29.** Los movimientos históricos admiten `occurred_at_known` (por defecto verdadero), para expresar que la
  fecha de un movimiento, como el capital inicial, es desconocida.
- **Lotes reversibles:** `batch_id`, auditoría, anulación posible y nunca borrar.

## Permisos y auditoría (corregidos)

- **Permisos.** `import.run` (subir, validar, previsualizar, confirmar y anular un lote) e `imports.view` (consultar
  lotes, informes y archivos). Ambos son de **alcance de proyecto** y se conceden al Administrador de Proyecto (el
  Administrador Global los recibe por la matriz); Colaborador y Lector no los reciben. Confirmar y anular exigen
  reautenticación y motivo.
- **Auditoría.** Un evento por lote y acción (`import.batch_uploaded`, `import.batch_validated`,
  `import.batch_imported`, `import.batch_annulled`) con contadores, semáforo y reconocimientos; el detalle por fila
  vive en el registro del lote. **La huella se llama `sha256`, nunca `hash`**: la redacción de la auditoría oculta
  cualquier clave que contenga `password`, `secret`, `token`, `hash` o `pepper`, y una clave `fileHash` se guardaría
  como `[redactado]`. Una prueba lo comprueba.

## Diferencias con el Excel: informativas y con semáforo (D-X17)

Excel no redondea y LetFer sí (dos decimales por apuesta; D-B8 pendiente). Las dos cifras no tienen por qué
coincidir al centavo y el importador **no las fuerza a coincidir**: las conserva como información en el informe del
lote.

**Verificación interna (exacta, obligatoria).** Tras escribir el lote, el saldo del ledger es exactamente la
reconstrucción de los datos importados (capital inicial + ganancia de cada apuesta con las cifras de LetFer), con
la invariante financiera y la verificación de integridad sin hallazgos: aquí la diferencia es `0.00`. No depende
del Excel.

**Contraste con el Excel (informativo), en dos niveles:**

1. **Por fila.** Residuo `r = valor del Excel − valor de LetFer` (retorno y ganancia).
   - **Verde:** `|r| <= 0.01` (incluye coincidencia exacta).
   - **Rojo:** `|r| > 0.01`, o difiere un campo que no es de redondeo (monto, cuota, estado).
2. **Total del lote.** Suma de los residuos por fila `T = Σ r`.
   - **Verde:** `|T| <= 0.01`.
   - **Amarillo:** `|T| > 0.01`, pero **explicable**: todas las filas son verdes y `|T|` no supera el máximo
     acumulable por redondeo (0.01 × número de filas cuyo valor del Excel tiene más de dos decimales).
   - **Rojo:** no explicable, incluido cuando un total de cabecera del Excel (p. ej. Ganancia o Bank Actual) no
     coincide con la suma de sus propias filas, señal de datos que no entraron o de celdas modificadas.

Ejemplo (Betsafe): 62.5 × 1.75 → Excel 109.375 frente a LetFer 109.38 (`r = −0.005`, verde); el total de 6
apuestas da `T = −0.005`, verde. Si D-B8 cambia la política de redondeo, el informe se recalcula sin tocar los
retornos guardados (el calculado se guarda al liquidar; ADR 0019).

## Mapeo

| Excel | LetFer |
|---|---|
| Nombre del archivo | Casa (D-X8) |
| Bank Inicial | `INITIAL_CAPITAL` histórico de esa casa, 00:00 de la fecha de su primera apuesta, `occurred_at_known = false`, etapa de la primera ronda (D-X3/D-X18, D-X23, D-X29) |
| RONDA n | Etapa, con `starts_at` y `batch_id` (D-X7, D-X28); la última puede quedar activa; las anteriores, cerradas |
| N° | Identidad de la fila junto con el `sha256` del archivo (D-X10) |
| FECHA | `placed_at` a las 12:00 en la zona del proyecto, `placed_time_known = false` (D-X23) |
| — (no existe) | `settled_at = placed_at`, `settled_time_known = false` (D-X20) |
| APUESTA | Monto oficial no confirmado; `stake = monto / unidad de la etapa`, informativo (D-X19) |
| CUOTA | `visible_total_odds` (hasta 6 decimales); única cuota de un múltiple (D-X15) |
| TIPO | Se declara; LetFer deriva el tipo del texto y avisa si difiere (D-X24) |
| GANADO | `WON` con retorno calculado sin confirmar (D-X4) |
| PERDIDO | `LOST` |
| PENDIENTE | `PENDING` (compromete saldo y cuenta como reserva histórica) |
| PARTIDO | Selecciones con su texto y sin cuota individual (D-X13, D-X15) |
| DEPORTE | Deporte de las selecciones |
| A+G, GANANCIA, Bank Actual, Balances, META, %, contadores | **No se importan**; control informativo |
| Plantilla, vacías y parciales | No se importan; se reportan (D-X21, D-X21b) |

Columnas mínimas por apuesta: fecha, casa (archivo), monto, cuota y resultado. Opcionales: hora, fecha de
liquidación, deporte, mercado, tipo, autor, etapa, selecciones desglosadas, ticket, identificador.

## Modelo de datos (Fase 9.1)

- **`import_batches`**: proyecto, casa, autor, `status` (`UPLOADED`, `VALIDATED`, `IMPORTED`, `ANNULLED`),
  nombre del archivo, `source_sha256`, `source_file` (`bytea`, máximo 10 MB), plan de etapas
  confirmado (ronda, unidad, fronteras), informe y contadores, `is_rehearsal`, motivos de importación y de anulación,
  fechas y autores de cada paso y `version`. Índice único parcial (proyecto, casa, `source_sha256`) donde el estado es
  `IMPORTED`, de modo que se puede reimportar tras anular. Inmutable tras importar, salvo los campos de anulación.
  Se bloquea la fila al confirmar: una doble confirmación se rechaza.
- **`import_rows`** (staging): lote, fila de origen, valores crudos y normalizados, clasificación (`VALID`,
  `TEMPLATE`, `EMPTY`, `PARTIAL`, `INVALID`), hallazgos, semáforo y el identificador de lo creado. Inmutable tras
  importar.
- **`batch_id`** (nulo) en `bets`, `financial_movements` y `stages`.
- **`stages.starts_at`** (nulo) y **`financial_movements.occurred_at_known`** (por defecto verdadero).
- **`bet_selections.visible_odds`** admite nulo, solo en apuestas de un lote, garantizado por un disparador (un
  `CHECK` no puede consultar la apuesta); la cuota total de la apuesta es la autoridad. El tipo compartido pasa a
  `OddsString | null` y la web muestra "no disponible". Se mantienen las filas de selección porque el deporte y el
  mercado del dashboard salen de ellas.
- **Permisos** `import.run` e `imports.view`.

## Flujo, escritura y anulación

- **Flujo.** Subida (crea el lote y su staging; no toca el ledger) → validación → vista previa (mismo código que
  la escritura, ejecutado y revertido, como en 8.5.3) → confirmación (`import.run`, reautenticación, motivo, backup
  reciente o ensayo declarado, reconocimiento si hay rojo o parciales) → escritura en una transacción bajo el
  bloqueo financiero → verificación → informe.
- **Proyecto apto.** Se rechaza importar si la casa tiene checkpoints, si el proyecto tiene apuestas o movimientos
  de esa casa fuera de un lote, o si no completó su setup. Es la guardia técnica de D-X1.
- **Escritura (D-X27).** Crea etapas (con `starts_at` y `batch_id`), el capital inicial y las apuestas con sus
  selecciones, ambas con `batch_id`, generando las filas del ledger con el motor de la Fase 8.5 y validando la línea
  de tiempo completa (incluidas las reservas de las pendientes) antes de confirmar.
- **Idempotencia.** Índice único parcial por `sha256`; reimportar el mismo archivo no duplica. Un archivo
  modificado se compara por contenido contra lo ya importado y se reporta (D-X10).
- **Anulación.** Aplica el motor con efecto vacío a cada apuesta del lote (revierte sus filas **vigentes**, aunque
  se hayan corregido después), las elimina lógicamente con "Lote anulado" (D-X25), revierte el capital inicial y
  elimina las etapas del lote si quedaron vacías; el lote pasa a `ANNULLED`. La operación valida la línea de tiempo
  (revertir el capital podría dejar negativas otras apuestas) y se rechaza con 409 si no es válida. Nada se borra.
- **Retornos por confirmar.** Todas las ganadas importadas aparecen como provisionales; el listado y el aviso del
  dashboard se pueden filtrar por lote.

## Cambios previos en el código (defectos que la importación destaparía)

1. **Capital del dashboard.** `periodCapital` suma `INITIAL_CAPITAL`, `DEPOSIT`, `WITHDRAWAL` y `EXTRAORDINARY` por
   tipo e ignora las filas `REVERSAL`: anular un lote dejaría el capital invertido (y el ROI) sin cambio. Debe
   calcularse con las filas vigentes, y `assertFinancialInvariant` debe hacer lo mismo. Defecto latente de la
   Fase 8.5, sin efecto hasta que se revierta un movimiento que no sea de apuesta.
2. **Restauración y papelera** de apuestas de un lote anulado (D-X25).
3. **Cuota nula** de las selecciones importadas en los tipos compartidos y la web (D-X15).
4. **Redacción de la auditoría** y el nombre `sha256`.

## Pendientes

- **D-X7:** unidad y fronteras exactas de cada etapa, hasta analizar los archivos reales (Betsafe y Betano). Afecta a
  los datos del plan de etapas del lote, no al esquema. El análisis de fórmulas de la subfase 9.2.0 encontró que
  la frontera entre rondas en Betsafe depende de la **posición** (bloques fijos de 13 filas que `Balances`
  referencia), no de un rótulo `"RONDA n"` visible en la hoja: solo la Ronda 1 tiene ese rótulo porque es la
  única que se usó. La unidad (12.5) queda reconfirmada por los montos reales, pero falta tu aprobación y
  contrastarla con Betano, que puede o no seguir la misma convención de rótulos.
- **D-B8:** redondeo del retorno calculado, hasta disponer de retornos oficiales de Betsafe y Betano (tickets o
  historiales), sobre todo de ganadas cuyo `monto × cuota` tenga más de dos decimales y de múltiples con cuotas de
  seis decimales. El Excel no es evidencia del redondeo de la casa. No se decide si la política es global o por casa.

## Pruebas de aceptación previstas

- Invariante financiera del lote (`assertFinancialInvariant`) y verificación de integridad sin hallazgos.
- Exactitud interna: el saldo del ledger es la reconstrucción de las apuestas importadas.
- Diferencias con el Excel reportadas por fila y en total con su semáforo, sin ninguna igualación forzada.
- La vista previa coincide con lo que se escribe; reimportar el mismo archivo no duplica.
- Anular un lote deja el proyecto como antes (efecto neto cero, dashboard y capital invertido en cero) sin borrar
  nada, también si alguna apuesta del lote se corrigió después; una apuesta anulada no se restaura ni aparece en la
  papelera.
- Filas de plantilla, vacías o parciales no se importan y se reportan; un múltiple sin cuotas individuales se importa
  con su cuota total.
- Un rojo o una fila parcial exigen reconocimiento; un error de validación bloquea; un proyecto no apto se rechaza.
- Backup reciente obligatorio en una importación real y exención auditada en un ensayo.
- Dos archivos (dos casas) en el mismo proyecto; permisos (`import.run`, `imports.view`) y auditoría con `sha256`
  sin redactar.
- Ninguna operación produce errores 500 ante archivos malformados.

## Fases previstas

9.0 análisis y documentación (cerrada) · **9.1 modelo** (migraciones, permisos, capital vigente del dashboard,
guardias de restauración y escritor de importación, sin lector de Excel ni web) · 9.2 lector, analizador de
selecciones y validación previa (requiere el archivo de Betano) · 9.3 vista previa, semáforo y contraste con el
Excel · 9.4 confirmación, backup previo, idempotencia y anulación de extremo a extremo · 9.5 interfaz web · 9.6
ensayo con los dos archivos y revisión final.

## Fuera de alcance

- Importar depósitos, retiros o transferencias (el Excel no los tiene) ni replicar las hojas de resumen.
- Decidir el redondeo (D-B8) o revertir transferencias.
- Importar sobre un proyecto operativo.
