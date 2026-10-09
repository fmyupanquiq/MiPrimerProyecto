# Plan de la Fase 10: pruebas reales y validación operativa

**Estado:** plan aprobado; Fase 10.1 (preparación del entorno) en curso. Solo análisis y
documentación, sin código. Referencias: §67 ("Fase 10 — Pruebas
reales: uso operativo, corrección de flujos y validación financiera. Requiere un respaldo funcional
previo"), §70 (criterio de LetFer v1 listo), §82 y §109.3–§109.4 (backups), §93 (zona horaria), §113
y ADR 0020 (importación), `docs/ESTADO_PROYECTO_TRANSFERENCIA.md`.

## 1. Objetivo

Comprobar que lo construido en las Fases 1 a 9 funciona como **un producto completo**, usado por
personas reales desde la interfaz, con datos reales, y que cumple el §70:

> Crear proyecto → configurar banca → distribuir casas → registrar apuestas → resolver apuestas →
> mover dinero → consultar resultados → conciliar con la casa → **saldo LetFer coincide con la
> realidad**.

La Fase 10 **no añade funcionalidad**. Cada problema encontrado se registra (sección 9), se
clasifica y, si hay que corregirlo, se corrige en una subfase propia con el ciclo habitual
(implementar → probar → corregir → confirmar). Una corrección que cambie una regla pasa primero por
la especificación (§69).

Queda fuera: despliegue, HTTPS, proveedor de correo y configuración de producción (Fase 11).

## 2. Punto de partida

- **Rama:** `fase-9.1/modelo-importacion`, 7 commits por delante de su remoto, sin integrar a
  `main`. Fases 1–9 completas.
- **Pruebas automáticas:** `npm run check` en verde (133 `shared`, 1186 `api`, 315 `web`, build).
  Todas usan PostgreSQL real, pero datos sintéticos.
- **Lo que nunca se ha probado de verdad:**
  - la aplicación usada de punta a punta en un navegador por una persona (todo el frontend se ha
    validado con pruebas automáticas, nunca a mano);
  - un **backup y una restauración reales**: `pg_dump`/`pg_restore` no están instalados en este
    entorno; las 2 pruebas "omitidas" de la suite son justo el volcado completo y la restauración
    de ida y vuelta (`backups.e2e-spec.ts`, `describe.runIf(pg_dump)`);
  - la importación contra el **`Betsafe.xlsx` real** (solo se analizó su estructura en la 9.2.0;
    todas las pruebas usan archivos sintéticos con su forma);
  - la **lectura de tickets con IA** contra el proveedor real;
  - el envío de correo (hoy va a una bandeja en archivos, `MAIL_OUTBOX_DIR`; el proveedor es de la
    Fase 11).

## 3. Entorno de pruebas reales

Decidido en la 10.1 (sección 11). Comandos y detalle en `docs/GUIA_ENTORNO_ENSAYO.md`.

- **Dónde:** la máquina de desarrollo, con `npm run dev` (API :3000, web :5173) y el PostgreSQL 17
  local (`embedded-postgres`). No hace falta un servidor todavía: la Fase 10 valida el producto, no
  la infraestructura.
- **Base de datos separada `letfer_trial`**, en el mismo clúster local que `letfer_dev` y
  `letfer_test`, para que los datos de las pruebas reales no se mezclen con los de desarrollo ni
  los borren las pruebas automáticas (`truncateAll`). Ojo: `npm run db:reset` borra el clúster
  entero, también esta base (hallazgo H-04).
- **Directorios propios** para `BACKUP_DIR`, `TICKETS_DIR` y `MAIL_OUTBOX_DIR`, fuera del repositorio
  (`C:\LetFerEnsayo\...`), definidos como variables de la sesión: tienen prioridad sobre `.env` y
  no cambian la configuración del proyecto.
- **Binarios de backup:** instalar las herramientas cliente de PostgreSQL **17** (misma versión que el
  servidor) y configurar `PG_DUMP_PATH`/`PG_RESTORE_PATH`; comprobar `TAR_PATH` (en Windows hay dos
  `tar` distintos). Sin esto no hay respaldo funcional y la Fase 10 no puede usar datos reales
  (§67, §82).
- **IA (opcional para empezar):** definir `ANTHROPIC_API_KEY` para la primera llamada real (el valor
  por defecto de `ANTHROPIC_MODEL`, `claude-sonnet-5-5`, ya quedó verificado en la Fase 10.6); sin
  clave, "Leer ticket con IA" muestra un error claro y los tickets se prueban solo como adjunto y
  registro manual.
- **Usuarios:** un Administrador Global (`npm run bootstrap:admin`) y cuentas reales o de prueba para
  cada rol: propietario/Administrador de Proyecto, Colaborador, Lector y una persona ajena al proyecto.
- **Proyecto de ensayo separado** para la importación (D-X1: la primera importación nunca va sobre un
  proyecto operativo).

## 4. Datos necesarios

| Dato | Para qué | Estado |
|---|---|---|
| `Betsafe.xlsx` real | Escenario B (importación) | Disponible en la máquina; nunca pasado por el pipeline |
| Archivo real de Betano | Escenario B con la segunda casa; D-X7; D-X24 | **No disponible** |
| Saldos oficiales actuales de cada casa | Conciliación (§80, §109.1) y cierre del ciclo §70 | Por reunir |
| Tickets reales (imagen/PDF) de ganadas, perdidas y múltiples | Escenario E (IA) y evidencia de D-B8 | Por reunir |
| Retornos oficiales de ganadas con `monto × cuota` de más de dos decimales | D-B8 (redondeo) | Por reunir |
| Un ejemplo real de apuesta "Creada" | D-X24 | No disponible |
| Unidad de stake de cada etapa y fronteras reales de las rondas | D-X7 y plan de etapas | Unidad 12.5 reconfirmada en Betsafe; fronteras por confirmar |

## 5. Flujos críticos y escenarios

Cada escenario se ejecuta **desde la interfaz**, y al terminar se comprueba con las herramientas de
la propia aplicación:

- la verificación de integridad (§109.2), sin hallazgos;
- el dashboard coherente con el ledger;
- la auditoría del paso;
- la conciliación, cuando haya saldo oficial.

### A) Flujo financiero

| # | Escenario | Resultado esperado |
|---|---|---|
| A1 | Crear proyecto y completar el setup (unidad de la Etapa 1, casas, banca inicial) | Etapa activa, casas con su saldo, capital en el ledger; nada financiero funciona antes del setup |
| A2 | Nueva etapa, nueva casa, desactivar/reactivar casa, corregir la unidad (reautenticación) | Etapa activa única; la casa nunca se borra; corrección auditada (§73) |
| A3 | Depósito, retiro con solicitud y aprobación (y autoaprobación §79), transferencia, extraordinario | Saldos por casa correctos; transferencia no cuenta como depósito/retiro/ganancia (regla 9); disponible nunca negativo |
| A4 | Registrar apuestas simples y múltiples, pendientes | El pendiente compromete saldo al instante (regla 8); no se puede apostar sin disponible |
| A5 | Liquidar: ganada, perdida, anulada, cash out | Ledger y dashboard; retornos calculados con su insignia de provisional |
| A6 | Confirmar retorno oficial igual y distinto del calculado (reautenticación) | El oficial manda (regla 4); diferencia registrada |
| A7 | Corregir una liquidación, reabrirla, eliminarla y restaurarla | Reversiones, nunca ediciones (§112); vista previa de impacto antes de aplicar |
| A8 | Mover una apuesta de etapa; editar fecha de colocación | Validación histórica; `placedAt <= settledAt` |
| A9 | Conciliar cada casa contra su saldo oficial real | `MATCHED` o discrepancia sin ajustes falsos (regla 10); una corrección posterior invalida el checkpoint |
| A10 | Dos personas trabajando a la vez sobre el mismo proyecto | Sin saldos negativos ni dobles registros; conflictos de versión claros |

### B) Importación histórica

Sobre un proyecto de ensayo (D-X1), primero con **Betsafe real** y, cuando exista, con Betano:

| # | Escenario | Resultado esperado |
|---|---|---|
| B1 | Subir el `.xlsx` real | Lote `UPLOADED`; archivo original conservado; nada en el ledger |
| B2 | Revisar la vista previa | Filas clasificadas como en el Excel; semáforo financiero y residuos plausibles; duplicados razonables |
| B3 | Confirmar la casa | `VALIDATED`; la disponibilidad se recalcula |
| B4 | Definir el plan de etapas | Las fronteras reales (bloques de 13 filas en Betsafe, D-X7) se pueden expresar; los rechazos de la API son comprensibles |
| B5 | Reconocer advertencias (si las hay) | Motivos correctos; queda en el lote y la auditoría |
| B6 | Confirmar sin backup y luego con backup real reciente | Sin backup: rechazo claro (o ensayo declarado); con backup: `IMPORTED` |
| B7 | Verificar el resultado | Saldo de la casa = capital + ganancia/pérdida de las apuestas del archivo; integridad sin hallazgos; dashboard coherente; diferencias con el Excel solo informativas |
| B8 | Reimportar el mismo archivo | No duplica |
| B9 | Anular el lote | `ANNULLED`; reversiones; efecto neto cero; apuestas fuera de la papelera y no restaurables una a una |
| B10 | Corregir una apuesta importada y después anular | Se revierte lo vigente, no lo original (§113.8) |

### C) Seguridad

| # | Escenario | Resultado esperado |
|---|---|---|
| C1 | Recorrer la aplicación con cada rol | Cada persona ve y puede hacer solo lo de su rol (§88); la interfaz no ofrece lo que la API rechazaría |
| C2 | Acceder por URL a un proyecto o lote ajeno | 404 idéntico a "no existe" (§105.3) |
| C3 | Acciones sensibles pasados 5 minutos del inicio de sesión | Se pide contraseña; cancelar no ejecuta nada |
| C4 | Intentos fallidos de inicio de sesión, recuperación de contraseña, invitaciones | Bloqueo temporal; respuestas indistinguibles; enlaces de un solo uso |
| C5 | Revisar la auditoría tras cada escenario | Un evento por operación, con actor y sin secretos |
| C6 | Protección de cuentas | No se puede deshabilitar al último Administrador Global ni a un propietario |

### D) Backups y recuperación

| Qué | Estado actual |
|---|---|
| Permisos, confirmación fuerte, reautenticación, manifiesto, rotación, programación, concurrencia y modo mantenimiento | Probado con pruebas automáticas (sin binarios reales) |
| Volcado completo real con `pg_dump` y checksum | **No probado aquí** (prueba omitida sin `pg_dump`) |
| Restauración real de ida y vuelta (base + tickets) | **No probado aquí** |
| Archivo original de las importaciones dentro del backup (`bytea`) | Implícito en el volcado completo; sin prueba real |
| Programación diaria real durante días seguidos y rotación de ~30 generaciones | No probado en tiempo real |
| Restaurar en una máquina limpia (recuperación ante desastre) | No probado |

Escenarios: D1 backup manual real; D2 restauración real tras cambiar datos (incluidos un lote
importado y tickets); D3 backup programado real; D4 restauración en una base vacía nueva siguiendo
solo la documentación.

### E) Otros flujos (menor prioridad)

- **Tickets e IA:** adjuntar, analizar, aplicar campos; el límite de análisis.
- **Dashboard y gráficos** con datos reales: filtros, Yield, ROI, drawdown y curva.
- **Administración:** usuarios, eliminación de cuenta, papelera, mantenimiento y visor de auditoría.
- **Uso en móvil:** interfaz adaptable (§61).

## 6. Criterios de aceptación de la Fase 10

1. El ciclo del §70 completo, con datos reales, en al menos un proyecto: el **saldo de LetFer
   coincide** con el saldo oficial de cada casa (conciliación `MATCHED`).
2. La verificación de integridad (§109.2) no tiene hallazgos después de cada escenario A y B.
3. Importación del `Betsafe.xlsx` real confirmada y anulada en el proyecto de ensayo con los
   resultados de B7 y B9; diferencias con el Excel explicadas.
4. Al menos un backup real y una restauración real verificados (D1 y D2).
5. Ningún escenario C muestra datos o acciones fuera del rol; ninguna respuesta 500 en todo el
   recorrido.
6. Todos los hallazgos registrados y clasificados; ninguno de severidad **bloqueante** abierto.

## 7. Bloqueos antes de producción

Se considera **bloqueante** (impide pasar a la Fase 11):

- Cualquier diferencia no explicada entre el ledger y la realidad (saldo, P/L o integridad).
- Cualquier camino que cree o pierda dinero sin un movimiento válido, o que deje un disponible
  negativo.
- Una fuga de datos entre proyectos o una acción permitida fuera del rol.
- **No tener un backup y una restauración reales probados** (§82): sin ellos no se usan datos
  reales en producción.
- Un error 500 o una pérdida de datos en un flujo principal.
- Importar el historial real de producción con **D-X7** sin decidir.

No bloquean, pero se registran para decidir: textos, estética, rendimiento aceptable y mejoras de
usabilidad.

## 8. Pendientes conocidos y riesgos

| # | Riesgo o pendiente | Impacto | Severidad inicial |
|---|---|---|---|
| R1 | **Backup/restauración reales sin probar** (`pg_dump`/`pg_restore` ausentes; 2 pruebas omitidas) | Sin respaldo funcional no hay datos reales (§82); una importación real exige backup reciente (D-X26) | **Bloqueante** |
| R2 | **Pipeline nunca ejecutado contra el `Betsafe.xlsx` real** | Clasificación, fechas, selecciones o contraste pueden fallar con datos reales | Alta |
| R3 | **D-X7**: las fronteras de ronda en Betsafe dependen de la posición (bloques de 13 filas), no de un rótulo; los candidatos de etapa solo detectan rótulos | El plan de etapas real se escribe a mano; un error asigna apuestas a la etapa equivocada | Alta (bloquea importar historial real en producción) |
| R4 | **Archivo real de Betano ausente**; solo existe el adaptador de Betsafe | No se puede importar la segunda casa ni validar D-X7/D-X24 con ella | Alta para la migración completa |
| R5 | **D-B8**: redondeo del retorno calculado provisional (`ROUND_HALF_UP`) | Retornos calculados que no coinciden con la casa; conciliaciones con céntimos de diferencia | Media |
| R6 | **D-X24**: "Creada" sin un ejemplo real | Tipo derivado mal calibrado (solo avisa, no bloquea) | Baja |
| R7 | **Zona horaria**: los formularios leían y la web mostraba las fechas en la zona del navegador (§93 pide la del proyecto) | **Mitigado (H-20, 10.3g)**: toda la web lee, escribe y presenta en la zona del proyecto | Resuelto |
| R8 | **Nombres en la importación**: el detalle del lote solo tiene el ID de quien reconoció, importó o anuló (el visor de auditoría sí muestra nombres) | Trazabilidad menos legible en la pantalla del lote | Baja |
| R9 | **Modelo de IA por defecto**: resuelto en la Fase 10.6 (ahora `claude-sonnet-5-5`); falta la primera llamada real con `ANTHROPIC_API_KEY` | Sin la clave, el análisis de tickets sigue mostrando un error claro en vez de fallar en silencio | Baja |
| R10 | **Correo**: solo bandeja en archivos | Invitaciones y recuperación no llegan a nadie hasta la Fase 11 | Media en uso real con varias personas |
| R11 | **Frontend sin prueba manual**: todo validado con pruebas automáticas | Problemas de usabilidad o flujos incómodos no detectados | Media |
| R12 | Aviso del build: paquete de la web de más de 500 kB | Carga inicial lenta en móvil | Baja |
| R13 | `ImportBatchSummaryRow` tipa sus fechas como `Date`; la lista de orígenes está duplicada en la web | Deuda técnica, sin efecto funcional hoy | Baja |
| R14 | **§113.6**: redacción pendiente ("vista previa ejecutada y revertida") | Especificación y sistema describen cosas distintas (§69) | Baja; requiere aprobación |
| R15 | Rama sin integrar a `main` y con 7 commits sin subir | Riesgo de perder trabajo o de divergencias | Media; decidir antes de empezar |

## 9. Registro de hallazgos

Cada hallazgo se anota en `docs/HALLAZGOS_FASE_10.md` (creado en la 10.1) con:

- identificador (`H-nn`) y escenario donde apareció;
- pasos para reproducirlo;
- resultado esperado y resultado obtenido;
- severidad (bloqueante / alta / media / baja);
- decisión y la subfase en la que se corrige.

## 10. Subfases propuestas

| Subfase | Contenido | Sale con |
|---|---|---|
| **10.1** | Preparar el entorno (en la rama actual): herramientas cliente de PostgreSQL 17, base `letfer_trial` y directorios propios, usuarios por rol, registro de hallazgos, guía del entorno | Entorno listo y documentado; `pg_dump --version` visible para la API |
| **10.2** | Backups reales (escenario D): D1–D4; las 2 pruebas hoy omitidas pasan | Respaldo funcional probado (§82); desbloquea el uso de datos reales |
| **10.3** | Flujo financiero real (escenario A) en un proyecto con datos reales, hasta conciliar cada casa | Ciclo del §70 cerrado con `MATCHED` |
| **10.4** | Seguridad (escenario C) recorriendo la aplicación con cada rol | Matriz de roles verificada a mano |
| **10.5** | Importación real de Betsafe (escenario B) en el proyecto de ensayo, incluida la decisión de **D-X7** con los datos a la vista | Lote real importado y anulado; D-X7 propuesta para aprobación |
| **10.6** | Correcciones de los hallazgos (una subfase o commit por grupo), con pruebas | Hallazgos bloqueantes y altos cerrados |
| **10.7** | Betano, D-B8 y D-X24 cuando existan el archivo y los retornos oficiales; tickets con IA real | Migración completa de ambas casas |
| **10.8** | Revisión final y cierre: criterios de la sección 6, actualización de la documentación | Recomendación de paso a la Fase 11 |

La 10.7 depende de datos externos y puede ir en paralelo o después de la 10.8, si se decide pasar a
producción solo con Betsafe.

## 11. Decisiones aprobadas (10.1)

1. **Rama:** la Fase 10 continúa en `fase-9.1/modelo-importacion`; no se integra a `main` todavía.
2. **Entorno:** local (sección 3 y `docs/GUIA_ENTORNO_ENSAYO.md`).
3. **Datos:** una base de ensayo separada (`letfer_trial`), con un proyecto operativo de ensayo para
   el flujo financiero y otro para la importación (D-X1); nada se hace sobre `letfer_dev`.
4. **Backups:** se instalan y configuran las herramientas cliente de PostgreSQL 17 para probar
   `pg_dump` y `pg_restore` (la instalación la hace la persona usuaria con los comandos de la guía).
