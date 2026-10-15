# 0024. Asistente «Añadir apuesta» de tres pasos, borradores y registro idempotente

- **Estado:** Aceptada. En producción está la variante que registra en el Paso 2 (`d6bd05a`); el flujo definitivo
  (2026-10-15, al final de este documento) está implementado en desarrollo y pendiente de desplegar.
- **Referencias:** ADR 0019, 0022, 0023; referencia visual `docs/referencias/letfer-referencia-verificar-datos.png`.

## Contexto

«Añadir apuesta» mezclaba entrada, revisión y registro en tres pasos (Origen, Apuesta, Confirmar) sin una pantalla
donde verificar todo lo recopilado. No existían borradores (cerrar el modal con Escape o un clic fuera perdía el
trabajo) y un doble envío o un reintento tras perder la respuesta podía crear la apuesta dos veces.

## Decisión

1. **Tres pasos con semántica propia.** 1 **Añadir apuesta** (ticket/IA, y los datos y la estructura), 2 **Verificar
   datos** (la pantalla de la referencia: datos, resultado, selecciones, ticket original y resumen, todo editable) y
   3 **Confirmar** (ticket digital reconstruido). **Solo «Registrar apuesta» del Paso 3 registra**: «Siguiente»,
   «Atrás», «Editar ticket», «Confirmar apuesta» (Paso 2) y Enter en un campo nunca envían nada.
2. **Una sola instancia de cada campo.** Casa, fecha, tipo, stake, monto, cuota total y resultado viven en dos
   tarjetas que se muestran en los pasos 1 y 2 (nunca el mismo control dos veces). Los pasos se ocultan con CSS sin
   desmontarse: cambiar de paso no pierde nada.
3. **Una Creada dentro de una Múltiple es UNA fila.** La tabla de selecciones se reconstruye desde la estructura real
   (`groupBetLegs`): el leg 2 muestra la insignia «Creada», «2 pronósticos», cada condición por separado y su cuota
   una sola vez. «Editar» abre un diálogo con `LegsEditor` limitado a ese leg (`fixedLeg`); no guarda nada.
4. **El resultado nace sin definir.** Ningún botón aparece marcado hasta que la IA lo lee o la persona lo elige; «Resultado
   detectado por IA» solo se muestra si lo propuso la IA (`statusFromAi`). «Estructura validada» es una validación
   estructural, no una garantía de lectura exacta.
5. **Borradores** (`bet_drafts`, migración 0045). Son el estado del formulario guardado (textos tal cual, sin
   interpretar): sin movimientos, sin reserva de saldo, fuera de informes. Pertenecen a quien los creó (otro miembro,
   incluso administrador, recibe 404); exigen `bets.create`; versión para concurrencia; borrado lógico; máximo 25 por
   persona y proyecto; el contenido se valida con un esquema zod (`betDraftPayloadSchema`) y un tope de 64 KB; el ticket
   referenciado debe ser del mismo proyecto. Al registrar la apuesta se descarta el borrador. Cerrar el modal con
   cambios sin guardar pide confirmación (seguir editando / guardar borrador y salir / descartar).
6. **Registro idempotente.** El cliente genera un `clientRequestId` por intento; `bets.client_request_id` con índice único
   (proyecto, creador, clave) hace que un reintento devuelva la apuesta ya creada (resuelto bajo el bloqueo financiero
   del proyecto). Un 4xx renueva la clave (no se creó nada); un fallo de red o 5xx la conserva. Además, un cerrojo en
   el cliente impide el doble clic.
7. **Seguridad adicional.** `GET /projects/:id/tickets/:ticketId` (requiere `tickets.view`) permite recuperar un ticket
   suelto al retomar un borrador.

## Consecuencias

- Migración 0045 aditiva (tabla nueva y una columna nula con índice único parcial). Rollback: `DROP TABLE bet_drafts` y
  `DROP INDEX`/`DROP COLUMN client_request_id`; las apuestas ya registradas no cambian.
- Los rótulos de resultado del asistente siguen la referencia («Ganado», «Perdido», «Anulado»); el resto de la
  aplicación conserva «Ganada», «Perdida», «Anulada».
- Límite conocido: los borradores guardan el `ticketId`, no una copia de la imagen; si el ticket se borrara, el borrador
  sigue siendo utilizable sin imagen.

## Revisión visual de alta fidelidad (2026-10-14)

Referencia prioritaria: `docs/referencias/letfer-ui-referencias/01-OBJETIVO-verificar-datos.png` (1672 × 941). Solo
presentación: no cambian reglas financieras, contratos ni la API.

- **Piel del asistente:** `.wizard-skin` (en `index.css`) redefine los tokens de color solo dentro del modal en el tema
  oscuro (navy azulado, tarjetas apenas elevadas, campos un paso más claros). El resto de la app no cambia.
- **Una sola zona de desplazamiento** para las dos columnas (~70/30). A 1672 × 941 el Paso 2 cabe entero, sin scroll.
  En los Pasos 1 y 3 la columna del ticket queda fija arriba (`sticky`) con su propio alto.
- **Compacto en la verificación:** las ayudas del Paso 1 (hora desconocida, zona, disponible, origen de la cuota ya
  declarado, notas) se ocultan en el Paso 2; lo que falte declarar se sigue mostrando. La procedencia del monto y de la
  cuota (Oficial / Calculada) va dentro del campo.
- **Rejillas por ancho de columna** (container queries sobre la columna `@container`), no por ancho de ventana: la
  tabla de legs pasa a tarjetas apiladas por debajo de 40rem y la tarjeta de datos a dos columnas por debajo de 44rem.
- La banda cuenta **legs**, nunca condiciones. Tras registrar: «Apuesta registrada correctamente» con «Ver apuesta».

## Rediseño de los tres pasos (2026-10)

Referencias: `docs/referencias/Referencias mockups/` (R1 Manual con respaldo, R2 Manual, R3 IA sin ticket, R4 IA con
ticket, R5 Verificar datos IA, R6 Confirmar IA, R7 Confirmar manual; 1672 × 941). Sustituye la semántica de los pasos
del punto 1 de la decisión; el resto (borradores, idempotencia, una instancia por campo, Creada = una fila) se mantiene.

1. **Paso 1 «Añadir apuesta» = origen y archivo.** Selector de origen *Ticket con IA* / *Manual* (`entryMode`, guardado
   en el borrador; opcional y deducido si falta, `draftEntryMode`). Zona de carga (arrastrar, seleccionar o pegar del
   portapapeles; «JPG, PNG, PDF • máx. 10 MB» desde las constantes de `ticket-files.ts`), estado del archivo, vista
   previa y estado del proceso. **El análisis solo ocurre con «Analizar y continuar»** (una vez; volver al Paso 1 con
   la lectura aplicada ofrece «Continuar» sin gastar otro análisis). Si falla: se queda en el Paso 1 con «Reintentar»
   y «Continuar en modo Manual», que conserva la imagen como respaldo. **Manual nunca llama a `analyze`**; su imagen es
   un respaldo que se vincula con `ticketId`. Sin `tickets.analyze`, el modo IA aparece deshabilitado y se empieza en
   Manual.
2. **Paso 2 «Verificar datos» = verificar y corregir; «Continuar a confirmar» valida y avanza, nunca registra.** Todo
   el formulario es editable (casa, fecha y hora, stake e importe, cuotas, resultado, legs y condiciones internas, la
   Creada dentro de una Múltiple, ticket original y avisos). «Continuar a confirmar» (`type="button"`, sin
   `data-action`) ejecuta en el cliente las mismas reglas que el registro (`buildCreatePayload`: `createBetSchema` y
   `validateSelectionStructure`); si falta algo, se queda en el Paso 2 con el error. Si todo está bien, **congela ese
   payload validado** y avanza. No llama a la API: no crea la apuesta, ni movimientos, ni cambia saldos, ni consume el
   borrador. Se mantienen «Atrás» (Paso 1), «Editar ticket» y «Guardar borrador». Los datos poco frecuentes viven en
   «Datos opcionales», plegado y sin apertura automática.
3. **Paso 3 «Confirmar» = revisar y registrar.** La revisión final es de solo lectura y se pinta **solo con el payload
   validado** (`bet-review.ts` → `BetReviewView`): lo que se ve es lo que se envía. Muestra el ticket digital de LetFer
   (`DigitalTicket`): casa, fecha y hora, tipo, resultado, etapa, unidad de stake y origen; todos los legs con partido,
   mercado, pronóstico, cuota del leg **una sola vez** y condiciones internas (la Creada dentro de la Múltiple como un
   leg); y el resumen financiero (stake, importe, cuota total con su procedencia ADR 0023, retorno potencial y, si se
   registra ya liquidada, retorno realizado y ganancia o pérdida), con las fórmulas de la API. A la derecha, el ticket
   original (ampliable) y el **impacto del registro** (disponible actual, lo comprometido y el disponible después;
   una pendiente no mueve el ledger hasta liquidarse). Las advertencias relevantes (cuota de referencia, hora
   desconocida, resultado sin elegir, disponible insuficiente, monto oficial ≠ stake × unidad) nunca bloquean.
   Botones: **«Atrás»** (vuelve al Paso 2 con todo intacto y descarta la revisión: al continuar se valida de nuevo) y
   **«Registrar apuesta»**, el **único** que registra. Lleva `data-action="register"` y el envío se ignora si no viene
   de él (Enter, el indicador o «Atrás» nunca registran). Al pulsarlo se reconstruye el payload y, si no coincide con
   el revisado (salvo la clave de idempotencia), se actualiza la revisión y se pide revisarla sin enviar nada. Se
   conservan el cerrojo de doble clic y el `clientRequestId` (4xx renueva, red/5xx conserva). Mientras se envía,
   «Registrando apuesta…» y el botón deshabilitado. Si falla, se queda en el Paso 3 con un error seguro y los datos
   intactos; nunca se afirma un registro sin la respuesta del backend.
4. **Después: «Registro completado».** Solo tras una respuesta correcta de la API, el MISMO Paso 3 (no un cuarto paso
   del indicador) pasa a mostrarse **solo con el `BetDetail` devuelto** (nunca con el formulario). Desde ahí no se
   vuelve atrás (el indicador deja de ser navegable) y cerrar no pide confirmación. Acciones: *Ver apuesta* (abre su
   detalle), *Ver historial* (cierra y resalta la apuesta), *Registrar otra apuesta* (asistente nuevo, otra clave de
   idempotencia, mismo origen), *Volver al dashboard* y *Cerrar*. El borrador se descarta **solo** tras el registro
   correcto, y se recargan apuestas, casas y borradores.
5. **Textos.** Subtítulos: Paso 1 «Carga tu ticket o registra una apuesta manualmente.»; Paso 2 IA «Revisa los datos
   extraídos por IA y confirma que la información sea correcta.»; Paso 2 Manual «Completa los datos de tu apuesta y
   confirma que la información sea correcta.»; Paso 3 antes de registrar «Revisa el resumen completo antes de
   registrar la apuesta.»; tras registrar «La apuesta ha sido confirmada y registrada en tu historial.». La banda IA
   cuenta selecciones = **legs**, nunca condiciones.

**Diferencias deliberadas con las referencias:** el modal mide 69rem en los tres pasos (R1–R4 son más estrechos) para
no cambiar de tamaño entre pasos; el origen es una tarjeta de selección; «Datos opcionales» agrupa campos que las
referencias no muestran; las cifras llevan su procedencia («Oficial»/«Calculada») porque la regla ADR 0023 lo exige; el
mercado de cada condición sigue visible en el Paso 2 para poder verificarlo; para una apuesta ya liquidada el Paso 3
indica que se corrige desde el historial con motivo (ADR 0019) en lugar de ofrecer edición.

**Verificación visual:** Playwright a 1672 × 941 (oscuro y claro) y 390 × 844 (sin desplazamiento horizontal), con el
análisis interceptado (caso Betano: Múltiple de 4 con una Creada, S/ 80.00, cuota 10.17, potencial S/ 813.60, Perdido).
A 1672 × 941 los pasos R1–R7 caben sin scroll; la verificación manual sin ticket desplaza ~40 px. Capturas en
`docs/referencias/capturas-anadir-apuesta/` (`escritorio-oscuro-*`, `escritorio-claro-*`, `movil-390-*` y
`comparativa-*` junto a cada referencia); no se versionan porque muestran un ticket real.

**Pruebas:** `NewBetWizard.spec.tsx` (análisis una vez, fallo con Reintentar/Manual, Manual sin análisis y con `ticketId`,
cambio de origen, portapapeles, Paso 2 → Paso 3 sin escribir, «Atrás» conserva y la revisión se actualiza, validación
al continuar, solo «Registrar apuesta» escribe, fallo de la API y reintento con la misma clave, borrador descartado solo
tras el éxito, variantes IA/Manual, Registrar otra/Ver apuesta/Ver historial/dashboard), `bet-review.spec.ts` (cifras,
Creada dentro de Múltiple, impacto), `BetsPage.spec.tsx`, `ticket-files.spec.ts` y `bet-draft-record.spec.ts`.

## Flujo definitivo del registro (2026-10-15)

Aprobado por el usuario el 2026-10-15, sustituye a las variantes anteriores (registro en el Paso 2 con «Confirmar
apuesta», del rediseño de 2026-10; y la corrección del 2026-10-14, que registraba en el Paso 3 sin validar al continuar
y con un resumen pintado desde el formulario): **Paso 1 añadir, Paso 2 verificar y corregir, Paso 3 revisar y
registrar, y después «Registro completado».** Los puntos 2 a 5 de la sección anterior describen el flujo vigente. La
regla según la cual el Paso 2 registra queda eliminada. No cambia nada en la API, el ledger, los cálculos decimales,
la procedencia de la cuota, el modelo de legs ni la idempotencia; no hay migraciones.
