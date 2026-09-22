# 0013. Etapas, casas y movimientos financieros

- **Estado:** Aceptada (Fase 3)
- **Fecha:** 2026-09-22
- **Referencias:** especificación §5, §11 a §17, §39, §49, §72 a §79, §106

## Contexto

La Fase 3 completa el flujo de creación de un proyecto (Etapa 1, unidad de stake, casas y banca
inicial) e introduce el ledger financiero: depósitos, transferencias internas, movimientos
extraordinarios y retiros con aprobación. Ocho decisiones funcionales (D1 a D8) las tomó la persona
responsable del producto y se documentan aquí y en la especificación (§106).

## Decisiones funcionales (confirmadas)

- **D1.** `POST /projects` (Fase 2) sigue creando solo el proyecto y su propietario. Se añade
  `POST /projects/:id/setup` para completar la configuración inicial (Etapa 1, unidad, casas, banca).
  Un proyecto puede existir sin configurar, pero no admite operaciones financieras hasta completarla.
- **D2.** El ledger es inmutable tras confirmarse: una corrección se hace con un movimiento nuevo,
  nunca editando el existente. El ciclo de estados de una solicitud de retiro no es una excepción:
  es el flujo de aprobación previo a que exista un movimiento, no la edición de uno confirmado.
- **D3.** Los saldos de una casa se calculan en cada consulta a partir de `financial_movements`; no
  se persiste un saldo. Se prioriza la integridad sobre la optimización prematura.
- **D4.** Una transferencia interna es una sola fila del ledger con `from_house_id`/`to_house_id`
  (no dos filas), con un `operation_id` para la auditoría. La operación es atómica.
- **D5.** Las solicitudes de retiro viven en una tabla propia (`withdrawal_requests`), con estados
  `PENDING`/`APPROVED`/`REJECTED`/`CANCELLED`. Solo al aprobarse se genera el movimiento definitivo.
- **D6.** Exigen reautenticación: aprobar un retiro, corregir la unidad de una etapa, registrar un
  movimiento extraordinario y transferir la propiedad. No la exigen: depósitos, transferencias
  internas, ni crear etapas o casas.
- **D7.** El catálogo de casas es libre por proyecto; no hay catálogo global.
- **D8.** El Colaborador solo tiene acceso de consulta a la información financiera operativa (casas,
  saldos, historial); no puede crear, aprobar ni modificar datos financieros.

## Decisión técnica

### Esquema

- `stages`: `id`, `project_id`, `name`, `unit_stake` (`numeric(18,2)`, `CHECK > 0`), `status`
  (`ACTIVE`/`CLOSED`/`TRASHED`). Índice único parcial: como mucho una etapa `ACTIVE` por proyecto.
  Crear una etapa cierra la anterior en la misma transacción.
- `houses`: `id`, `project_id`, `name`, `status` (`ACTIVE`/`INACTIVE`). Sin papelera propia: no se
  elimina físicamente (integridad financiera), solo se desactiva.
- `financial_movements`: ledger único. `type`
  (`INITIAL_CAPITAL`/`DEPOSIT`/`WITHDRAWAL`/`TRANSFER`/`EXTRAORDINARY`), `direction`
  (`CREDIT`/`DEBIT`, `NULL` en `TRANSFER`), `house_id` (movimientos de una casa) o
  `from_house_id`/`to_house_id` (transferencias), `amount` (`numeric(18,2)`, `CHECK > 0`),
  `operation_id`, `stage_id`, `reason`, `occurred_at`, `created_by`. `CHECK` de coherencia entre
  `type`/`direction`/`house_id`/`from_house_id`/`to_house_id` según el tipo. Disparadores
  `prevent_delete` y `prevent_modification` (§8, D2): ninguna fila se edita ni se borra tras
  insertarse.
- `withdrawal_requests`: `id`, `project_id`, `stage_id`, `house_id`, `amount`, `reason`, `status`,
  `requested_by`, `requested_at`, `decided_by`, `decided_at`, `decision_reason`, `movement_id`
  (solo si `APPROVED`), `version` (concurrencia optimista). Un disparador de protección de campos
  impide alterar los datos de la solicitud original (monto, casa, motivo) una vez decidida.
- `projects.setup_completed_at` (`timestamptz`, `NULL` hasta completar el setup): guarda de todas
  las rutas financieras y de creación de etapas/casas adicionales.

### Saldos (D3)

`balances.ts` calcula, por casa: `balance` (suma del ledger filtrado por esa casa, sumando
`from_house_id`/`to_house_id` según corresponda), `committed` (suma de retiros `PENDING` de esa
casa) y `available = balance - committed` (nunca negativo: se valida antes de reservar un retiro o
registrar un movimiento `DEBIT`). Sin caché: cada consulta recorre el ledger completo del proyecto.

### Transferencias (D4)

`movements.service.ts` registra ambas casas en una única fila y en una única transacción; valida
que ambas casas existan, estén `ACTIVE`, sean del proyecto y sean distintas, y que la casa de origen
tenga disponible suficiente, todo bajo `.for('update')` sobre las casas involucradas (mismo patrón
de `lockByKey` que el resto de operaciones financieras críticas).

### Retiros (D5)

`withdrawals.service.ts`: `request()` valida disponible y crea la solicitud `PENDING` (reserva
inmediata vía `committed`, sin tocar el ledger). `approve()` bloquea la casa, **revalida** el
disponible sobre el estado actual (por si algo cambió entre la solicitud y la aprobación: es una
defensa adicional, no solo el `version` de la solicitud) y, si es válido, inserta el movimiento
`WITHDRAWAL` y marca la solicitud `APPROVED` con su `movement_id`, todo en una transacción. `reject()`
y `cancel()` solo cambian el estado; no generan movimiento. Regla de autoaprobación (§79): quien
solicita no puede aprobar su propia solicitud si algún otro miembro del proyecto tiene el permiso
`withdrawals.approve` por su rol (global, de membresía o personalizado); el Administrador Global
siempre puede aprobar; si nadie más puede, el propio solicitante puede aprobar con reautenticación.

### Permisos (D8)

Catálogo ampliado en `@letfer/shared` (`permissions.ts`): `stages.view/create/correct_unit/trash/
restore`, `houses.view/create/deactivate`, `movements.view/deposit/transfer/extraordinary`,
`withdrawals.request/approve`. `PROJECT_ADMIN` recibe los quince; `COLLABORATOR` y `READER` solo los
de consulta (`stages.view`, `houses.view`, `movements.view`); ningún rol de sistema recibe
`withdrawals.approve` salvo `PROJECT_ADMIN`, de modo que aprobar retiros exige o ser Administrador de
Proyecto/propietario/Global, o un rol personalizado con ese permiso explícito.

### Web

Página de configuración inicial (wizard de unidad + casas + banca), página de Etapas (crear/activar,
corregir unidad con vista previa antes de confirmar, papelera) y página de Casas y Finanzas (casas
con saldos, registrar movimiento por pestañas, historial y solicitudes de retiro). Las acciones que
exigen reautenticación usan `runWithReauth` (mismo patrón de la Fase 2); mientras el proyecto no está
configurado, estas páginas remiten a `/projects/:id/setup` en vez de mostrar su contenido.

## Consecuencias

- Toda operación financiera queda bloqueada hasta que `POST /projects/:id/setup` se complete; las
  rutas de etapas, casas y movimientos devuelven 409 `INVALID_STATE` si se llaman antes.
- El cálculo de saldos por consulta es la fuente de verdad; si en el futuro se necesita una caché
  por rendimiento, deberá ser reconstruible desde el ledger y nunca sustituirlo como fuente de
  verdad (§3, D3).
- Las apuestas (Fase 4) añadirán su propio componente al "comprometido" de una casa (§92): el cálculo
  de `available` de esta fase solo contempla los retiros `PENDING`.
