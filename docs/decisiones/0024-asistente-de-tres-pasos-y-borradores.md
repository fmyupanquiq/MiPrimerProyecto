# 0024. Asistente «Añadir apuesta» de tres pasos, borradores y registro idempotente

- **Estado:** Aceptada e implementada en desarrollo y pruebas (no aplicada a producción).
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
