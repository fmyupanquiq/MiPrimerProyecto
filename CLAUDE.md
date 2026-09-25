# LetFer: guía para Claude Code

## Fuente de verdad

`docs/ESPECIFICACION_LETFER_V1_1.md` es la **única** fuente de verdad funcional y técnica.
Léela completa antes de implementar funcionalidad. La adenda (§71–§106) prevalece sobre el
cuerpo si ambos difieren. Si una regla debe cambiar: primero se actualiza la especificación
(con aprobación del usuario) y luego el código.

## Forma de trabajo (§68, §103)

- Trabaja solo dentro del alcance de la fase o tarea solicitada. No construyas fases futuras.
- No inventes ni cambies reglas de negocio ni decisiones financieras sin aprobación.
- Si hay una decisión funcional pendiente, detente y consulta antes de continuar.
- Ciclo por fase: implementar → probar → corregir → confirmar → siguiente fase.
- Commits pequeños y claros. No se integra a `main` sin confirmación del usuario.
- Al terminar informa: archivos creados/modificados, migraciones, pruebas y problemas.

## Reglas críticas de dominio (resumen; ante duda manda la especificación)

- Nunca `float`/`number` para dinero o cuotas: `NUMERIC` en PostgreSQL y una librería decimal
  en TypeScript; los decimales viajan por la API como cadenas.
- Un solo ledger financiero; los saldos se reconstruyen desde registros canónicos y las cachés
  no son fuente de verdad.
- Nunca saldo disponible negativo; no se crea dinero sin movimiento válido; sin ajustes falsos.
- Los valores oficiales confirmados de la casa prevalecen sobre cálculos teóricos.
- La IA propone, el humano confirma, el backend valida y recién entonces se registra.
- Permisos y reglas se validan siempre en el backend. Eliminaciones ordinarias: lógicas.
- Operaciones financieras críticas: transaccionales, auditadas, con control de concurrencia
  e idempotencia.

## Repositorio

- Monorepo con **npm workspaces** (no pnpm ni yarn): `apps/api` (NestJS), `apps/web`
  (React + Vite + Tailwind), `packages/shared`.
- Todo el código es TypeScript ESM (NestJS 12 es solo ESM): en `api` y `shared` los imports
  relativos llevan extensión `.js`.
- `packages/shared` se compila a `dist/`; los demás workspaces lo consumen ya compilado, por
  eso los scripts de la raíz lo construyen primero.
- Versiones de dependencias fijadas sin `^` (ver `.npmrc`). No subas `.env` ni secretos.
- Decisiones técnicas registradas en `docs/decisiones/` (léelas antes de cambiar herramientas).
- ORM: **Drizzle** (ADR 0003). Dinero/cuotas: `numeric` y decimales como cadena, nunca `number`;
  `CHECK`/índices únicos parciales en el esquema; `.for('update')` al gastar saldo; acceso a datos
  solo desde repositorios/servicios, nunca en controladores.
- PostgreSQL local de desarrollo: `npm run db:start` (PostgreSQL 17 vía `embedded-postgres`,
  bases `letfer_dev` y `letfer_test`). Las pruebas de integración usan `letfer_test`, sin simular
  la base de datos.
- TypeScript se mantiene en 6.0.x mientras `typescript-eslint` no soporte la 7 (ADR 0001).

## Convenciones de la API (Fase 1, ADR 0005 a 0008)

- **Denegar por defecto**: toda ruta exige sesión salvo las marcadas con `@Public()`. Para acciones
  sensibles usa `@RequireRecentAuth()` (contraseña confirmada en los últimos 5 minutos).
- **Validación**: esquemas zod en `@letfer/shared`, usados con `@Body({ schema })` (la forma
  `@Body(schema)` no valida en Nest 12). Errores con la forma `ApiErrorBody` y códigos `ErrorCode`.
- **Auditoría**: `AuditService.record(tx, …)` con la transacción de la operación auditada; nunca
  guardes secretos (las claves password/token/hash/secret se redactan).
- **Concurrencia**: `version` + `nextVersion`/`expectUpdated` para ediciones; `lockByKey` para
  serializar por recurso lógico. Operaciones con varios efectos: `db.transaction` y pasar el
  `tx` a los servicios (`DbExecutor`).
- **Migraciones**: cambiar el esquema → `npm run db:generate` → revisar el SQL; las reglas que
  Drizzle no modela (disparadores) van en migraciones personalizadas (`drizzle-kit generate
--custom`). Nunca edites una migración ya aplicada.
- **Tiempo**: inyecta `Clock`, nunca `new Date()` en la lógica; en pruebas usa `FakeClock`.
- **Pruebas**: PostgreSQL real (`letfer_test`), `createTestApp()` (`test/support/create-app.ts`)
  para e2e con reloj falso y correo en memoria. `npm test` arranca la base de datos sola.
- **Secretos y usuarios**: nunca imprimas contraseñas ni tokens; la respuesta de login, recuperación
  y contraseña incorrecta debe ser indistinguible para no revelar si una cuenta existe.
- **Web**: la web nunca ve el token de sesión (cookie HttpOnly); las llamadas van a `/api`.

## Convenciones de la Fase 2 (ADR 0009 a 0012)

- **Permisos**: el catálogo y la matriz de roles de sistema viven en `@letfer/shared`
  (`permissions.ts`) y se sincronizan con la base de datos al arrancar (`reconcileRbac`). No
  compares nombres de rol en la lógica: pide un permiso. Rutas: `@RequireGlobalPermission(...)` o
  `@ProjectRoute(permiso, { allowTrashed? })` (inyecta `@CurrentProject()`). Quien no tiene acceso
  al proyecto recibe **404** (igual que si no existiera); quien lo tiene y le falta el permiso, **403**.
- **Roles**: nadie asigna un rol con permisos que no tiene ni gestiona a alguien con un rol superior
  (`canAssignRole`). `PROJECT_OWNER` y los roles globales nunca se asignan.
- **Propietario**: siempre miembro activo con rol `PROJECT_ADMIN` (lo garantizan disparadores en
  la base de datos). Solo el Administrador Global transfiere la propiedad.
- **Membresías**: una fila por (proyecto, usuario); salir, ser expulsado y volver reutiliza la fila
  (`MembersService.addOrReactivate`). Nunca se borran.
- **Ciclo de vida del proyecto**: `FOR UPDATE` sobre la fila; transiciones inválidas → 409
  `INVALID_STATE`; cerrar, reabrir, papelera y restaurar llevan `@RequireRecentAuth()`.
- **Invitaciones**: solo se guarda el hash SHA-256 del token; el enlace se muestra una vez; todo
  enlace inválido responde igual (`INVALID_TOKEN`); nunca pongas el token ni su hash en la
  auditoría. Aceptar se serializa bloqueando la invitación.
- **Web**: `useAuth().can()` y `useProject().can()` solo mejoran la interfaz (manda la API);
  acciones sensibles con `useReauth()`/`runWithReauth`; datos con `useLoad(clave, cargador)`;
  `?next=` solo con `safeNextPath`. Pruebas con `stubApi` (falla ante peticiones no previstas).
- **Pruebas**: `insertProject`/`insertMember` (`test/support/factories.ts`) crean proyecto y
  membresías respetando los disparadores; `truncateAll` vuelve a sembrar el RBAC.

## Convenciones de la Fase 3 (ADR 0013, §106)

- **Setup del proyecto (D1)**: `POST /projects` solo crea el proyecto y su propietario;
  `POST /projects/:id/setup` completa la Etapa 1, las casas y la banca inicial, y solo puede
  ejecutarse una vez (`projects.setupCompletedAt`). Ninguna ruta financiera ni de etapas/casas
  adicionales funciona antes de completarlo.
- **Ledger (D2, D3)**: `financial_movements` es inmutable tras insertarse (`prevent_modification`);
  una corrección es un movimiento nuevo, nunca una edición. Los saldos de una casa (`balance`,
  `committed`, `available`) se calculan por consulta desde el ledger (`finance/balances.ts`); no se
  persiste un saldo como caché.
- **Transferencias (D4)**: una transferencia interna es una sola fila con `fromHouseId`/`toHouseId`
  y un `operationId`, registrada de forma atómica bajo `.for('update')` sobre ambas casas.
- **Retiros (D5)**: `withdrawal_requests` es una tabla aparte con su propio ciclo
  (`PENDING`/`APPROVED`/`REJECTED`/`CANCELLED`); solo aprobar genera el movimiento definitivo en el
  ledger, con revalidación del disponible sobre la casa bloqueada. Autoaprobación (§79): solo si
  ningún otro miembro tiene `withdrawals.approve` por su rol; en ese caso exige reautenticación.
- **Reautenticación (D6)**: exigen `@RequireRecentAuth()` aprobar un retiro, corregir la unidad de
  una etapa y registrar un movimiento extraordinario. Depósitos, transferencias y crear
  etapas/casas no la exigen.
- **Casas (D7)**: catálogo libre por proyecto, sin catálogo global; una casa nunca se elimina, solo
  se desactiva/reactiva.
- **Permisos (D8)**: `stages.*`, `houses.*`, `movements.*` y `withdrawals.*` en `@letfer/shared`
  (`permissions.ts`); `COLLABORATOR`/`READER` solo reciben los de consulta (`*.view`).
- **Web**: `ProjectSetupPage`, `StagesPage` y `FinancePage` remiten a `/projects/:id/setup` mientras
  `project.setupComplete` sea falso, en vez de mostrar su contenido. Mismos patrones de la Fase 2
  (`useReauth`, `useLoad`, `stubApi`) para las acciones y pruebas nuevas.

## Convenciones de la Fase 8 (ADR 0018, §111)

- **Auditoría**: `audit_logs` no se purga ni se edita. El visor por proyecto fija el proyecto
  desde la ruta (nunca acepta un `projectId` del cliente); paginación por cursor con
  microsegundos. La redacción de claves (`password`/`token`/`hash`/`secret`) también afecta a los
  metadatos: no nombres así un contador.
- **Protección de cuentas**: deshabilitar o eliminar pasa siempre por `AccountProtectionService`
  (`guard` + `assertCanDeactivate`): nunca el último Administrador Global activo
  (`LAST_GLOBAL_ADMIN`, con disparador en la base de datos) ni a quien es propietario de algún
  proyecto (`OWNS_PROJECTS`). El intento bloqueado se audita **fuera** de la transacción revertida.
- **Eliminación de cuenta**: solicitud (`account_deletion_requests`, una pendiente por usuario) →
  aprueba el Administrador Global con `@RequireRecentAuth()`; siempre borrado lógico.
- **Papelera**: solo lectura + restaurar por los endpoints existentes; "elegible para purga" es
  informativo. **No hay purga física** de datos de negocio (decisión futura, §89).
- **Mantenimiento**: solo purga sesiones, intentos de acceso y tokens de recuperación caducados
  (`MaintenanceService`); la purga y su registro (`maintenance_runs`, inmutable) van en una
  transacción. Un `null` suelto no se serializa en Nest: responde un objeto (`{ request: … }`).

## Convenciones de la Fase 8.5 (ADR 0019, §112)

- **Corregir el ledger = revertir, nunca editar (D-A1, D-A2)**: todo cambio del efecto financiero de
  una apuesta pasa por `finance/bet-ledger.ts` (`planBetLedgerChange` sin escribir, `applyBetLedgerPlan`
  al aplicar). Solo se revierte lo que cambia (filas `REVERSAL` con `reverses_movement_id`, misma fecha
  efectiva que la fila anulada) y se añaden filas nuevas con `correction_id`; `bet_corrections` es
  inmutable. Nunca insertes `BET_PLACEMENT`/`BET_SETTLEMENT` a mano fuera del motor.
- **Liquidadas**: sin edición directa de campos financieros ni de `placedAt`. Corregir, reabrir,
  eliminar y restaurar una liquidada solo por `BetCorrectionsService` (`bets.correct`, reautenticación,
  motivo, versión). Una sola ruta de ejecución; la **vista previa ejecuta ese mismo camino y lo
  revierte** (nunca un cálculo aparte). Reabrir limpia la fila pero conserva los valores previos en
  `bet_corrections.before` y la auditoría. `placedAt <= settledAt` siempre (D-A10).
- **Validación histórica (§74, D-A5)**: la línea de tiempo por casa (`bet-ledger-timeline.ts`) rechaza
  con 409 `CORRECTION_CONFLICT` un saldo bruto negativo en cualquier instante; el comprometido se
  modela como débito desde la colocación o solicitud de cada apuesta y retiro pendiente (`BetHold`).
  Límite conocido: no se sabe cuándo dejó de existir una reserva ya resuelta más allá del ledger.
- **Retornos (§77, D-A3)**: `official_realized_return` no nulo = confirmado; solo `calculated_realized_return`
  = provisional (se calcula únicamente con `calculateBetReturn`, política de redondeo provisional
  D-B8, **pendiente**: no la cambies sin decisión). `amount_confirmed` solo significa que alguien
  confirmó el **monto**, nunca que LetFer congeló su cálculo. Confirmar con diferencia exige
  `acknowledgeDifference` y reautenticación (`@RequireRecentAuthWhen`); `assertRecentAuth` cuando la
  exigencia depende del estado del recurso.
- **Fuente única de verdad = ledger**: monto apostado, ganancia/pérdida, Yield, ROI y curva de
  rendimiento del dashboard salen del ledger (las reversiones cuentan). La verificación de integridad
  compara el ledger con los datos de cada apuesta y cuenta **filas vigentes** (`BET_LEDGER_NET`,
  `SETTLEMENT_SHAPE`, `REVERSAL_INTEGRITY`, `CHECKPOINT_INVALIDATION`). Cifras monetarias siempre con
  dos decimales.
- **Checkpoints (§112.5)**: una corrección invalida los `MATCHED` de las casas afectadas de fecha igual
  o posterior a la fecha más antigua de las filas anuladas y nuevas, y solo si el ledger cambia.
- **Invariante financiera**: toda prueba de un flujo financiero nuevo o modificado termina con
  `assertFinancialInvariant` (`test/support/financial-invariant.ts`): ledger = dashboard = conciliable,
  P/L, Yield y ROI según las apuestas, curva, aviso de retornos e integridad sin hallazgos. Las
  secuencias completas (incluida la pseudoaleatoria de `bets-corrections.e2e-spec.ts`) la comprueban
  tras cada paso, con operaciones rechazadas y sin errores 500.
- **Proyecto cerrado**: las correcciones se permiten (tarea administrativa y conciliación final, §85);
  en un proyecto en la papelera responden 404.
- **Web**: `BetFinancialPanels.tsx`; nunca se aplica una corrección o reapertura sin haber visto el
  impacto vigente; los retornos calculados se muestran siempre con su insignia. `OWNER_PERMISSIONS` de
  `test-utils` debe seguir a la matriz real (lo comprueba `test-utils.spec.ts`).
- **Pruebas**: con supertest, los `request()` se inician al esperarlos: para varias llamadas en
  secuencia crea funciones (`() => post(...)`), no objetos ya construidos. `truncateAll` también vacía
  `bet_corrections`.

## Comandos (desde la raíz)

- `npm run check`: formato, lint, tipos, pruebas y build (ejecútalo antes de dar algo por hecho).
- Por separado: `npm run build` · `npm run typecheck` · `npm run lint` · `npm test` ·
  `npm run format:check`.
- `npm run dev` levanta API (:3000) y web (:5173). `npm run db:start|stop|status|reset` gestiona
  PostgreSQL local; `npm run db:generate|db:migrate` gestionan las migraciones;
  `npm run bootstrap:admin` crea el primer Administrador Global.
