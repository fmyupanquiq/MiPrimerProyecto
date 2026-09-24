# 0016. Confianza y recuperación

- **Estado:** Aceptada (Fase 5.5, previa a la Fase 6 numerada)
- **Fecha:** 2026-09-23
- **Referencias:** especificación §32, §37, §38, §72, §74, §80, §82, §109

## Contexto

Antes de usar LetFer con datos reales, el §82 exige una estrategia funcional de
respaldo/restauración, y el §32/§80 exigen conciliación contra el saldo real de cada casa. Se
decidió además incluir una herramienta de verificación de integridad del ledger (§38), ya que
sin ella la conciliación solo detecta discrepancias contra el mundo exterior, no problemas
puramente internos. Diez decisiones (D-C1 a D-C7, D-I1 a D-I3, D-B1 a D-B4, D-R1) las tomó la
persona responsable del producto y se documentan aquí y en la especificación (§109).

## Decisiones funcionales (confirmadas)

- **D-C1.** Se registra todo intento de conciliación, coincida o no (`MATCHED`/`DISCREPANCY`).
- **D-C2.** Un solo paso; solo Administrador de Proyecto/Global concilian.
- **D-C3.** El comprometido es diagnóstico, no participa en la comparación.
- **D-C4.** La conciliación es por casa, no por etapa.
- **D-C5.** Sin estado "RESUELTO": se corrige el dato real y se concilia de nuevo.
- **D-C6.** "Requiere nueva conciliación" es informativo, nunca bloquea operaciones.
- **D-C7.** No exige reautenticación (no mueve dinero).
- **D-I1.** Cinco comprobaciones de integridad v1 (balances, liquidaciones, referencias de
  apuestas pendientes, forma del ledger, invalidación de checkpoints).
- **D-I2.** Solo manual, bajo demanda; sin tareas programadas todavía.
- **D-I3.** Alcance por proyecto (Administrador de Proyecto) y global (Administrador Global).
- **D-B1.** Backup disparado desde dentro de la API, sin cron del sistema operativo ni proveedor
  específico; directorio configurable por variable de entorno.
- **D-B2.** `pg_dump` en formato personalizado, siempre completo, nunca parcial.
- **D-B3.** El manifiesto de generaciones vive en un archivo junto a los volcados, no en
  PostgreSQL.
- **D-B4.** Retención aproximada de 30 generaciones diarias.
- **D-R1.** Restauración como operación de mantenimiento controlada, no en caliente.

## Decisión técnica

### `pg_dump`/`pg_restore` deben estar en el `PATH` (limitación conocida)

Al implementar, `embedded-postgres` (la dependencia ya usada para PostgreSQL local, ADR 0002)
resultó **no incluir** `pg_dump`/`pg_restore`: solo empaqueta `initdb`, `pg_ctl` y `postgres`.
Se consultó a la persona responsable del producto entre tres opciones (volcado lógico propio,
exigir el cliente de PostgreSQL instalado, o añadir una nueva dependencia que empaquete los
binarios) y se confirmó **mantener `pg_dump`/`pg_restore` como lo exige D-B2**, exigiendo que
el entorno (desarrollo y producción) los tenga instalados y en el `PATH`.

Consecuencia directa para las pruebas: en un entorno sin esos binarios (como el usado para
desarrollar esta etapa), las pruebas del volcado/restauración **reales** (round-trip completo)
se omiten automáticamente si no se detecta `pg_dump` en el `PATH`, en vez de fallar en rojo o
simular el comportamiento. El resto de `BackupsService` (manifiesto, rotación, decisión de
"¿toca backup hoy?", permisos, endpoints) sí se prueba por completo sin depender de esos
binarios. **Antes de operar con datos reales, alguien debe ejecutar esas pruebas en un entorno
que sí tenga `pg_dump`/`pg_restore` instalados**, para confirmar el mecanismo de extremo a
extremo.

### Invalidación de checkpoints (§74, §109.1.3)

Se calcula comparando `bet.placedAt` contra `checkpoint.occurredAt`: una apuesta colocada antes
o en el instante del checkpoint que luego se edita, liquida, mueve de etapa, elimina o restaura
invalida ese checkpoint (la fotografía que asumía ya no es correcta); una apuesta posterior
nunca lo invalida (es actividad nueva, no una corrección retroactiva). Los movimientos del
ledger nunca invalidan checkpoints por sí mismos porque son inmutables e insertar uno nuevo
siempre ocurre "ahora" (D2): solo las apuestas tienen mutabilidad histórica real (§24, §25, §26).
La comprobación se ejecuta dentro de la misma transacción que la acción sobre la apuesta, en
`BetsService`, reutilizando el patrón ya establecido de `assertNotTrashed`/`lockByKey`.

### Sin tablas para "requiere nueva conciliación" ni para el manifiesto de backups

Coherente con D3 (Fase 3) y D-B7/D-M10 (Fases 4 y 5): nada que pueda derivarse en consulta se
guarda como una segunda fuente de verdad. "Requiere nueva conciliación" se deriva del último
`reconciliation_checkpoints` no invalidado; el manifiesto de backups vive fuera de PostgreSQL
precisamente para no depender de la misma base que respalda (D-B3).

### Nuevas tablas

- **`reconciliation_checkpoints`**: solo inserción; la única mutación permitida es que el
  sistema marque `invalidatedAt`/`invalidatedReason` (nunca una edición manual de las cifras
  comparadas) — mismo espíritu de inmutabilidad que `financial_movements` (D2).
- **`integrity_check_runs`**: registro histórico de cada ejecución (quién, cuándo, resultado,
  hallazgos en `jsonb`); tampoco se edita ni se borra.

### Nuevo prefijo de permisos `system.*`

Hasta ahora todos los permisos globales (`projects.create`, `projects.list_all`,
`projects.transfer_ownership`) son verbos sobre proyectos. Las capacidades de administración de
la instancia completa (backups, integridad global) no encajan ahí: se introduce `system.*`
como prefijo para este tipo de permisos, reservados al Administrador Global.

## Consecuencias

- Queda una obligación operativa explícita para antes de usar datos reales: verificar el
  mecanismo de backup/restauración en un entorno con `pg_dump`/`pg_restore` instalados (esta
  etapa lo deja implementado y con todo lo demás probado, pero no ese último tramo).
- `BetsService` gana una responsabilidad nueva (invalidar checkpoints) además de las ya
  existentes; se mantiene como un método privado más, sin cambiar su interfaz pública.
- Cuando la Fase 7 (tickets e IA) exista, el manifiesto de backups fuera de PostgreSQL facilita
  incorporar archivos/tickets a la misma estrategia de respaldo sin rediseñar el mecanismo.
