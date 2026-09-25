# ESPECIFICACIÓN MAESTRA LetFer v1.1

**Estado:** Aprobada y actualizada para inicio de desarrollo\
**Propósito:** Fuente de verdad funcional y técnica para la construcción
de LetFer v1.\
**Regla de mantenimiento:** Si durante el desarrollo se modifica una
regla funcional, esta especificación debe actualizarse junto con el
código.

------------------------------------------------------------------------

## 1. Propósito y principios

LetFer es un sistema privado para administrar y analizar la actividad de
apuestas de un pequeño equipo. Sustituye el control actual mediante
Excel y centraliza proyectos, usuarios, banca, casas de apuestas,
etapas, apuestas, tickets, conciliaciones, auditoría y análisis.

La primera versión será web y responsive. Una futura aplicación móvil
utilizará el mismo backend, API y base de datos.

Principios fundamentales:

-   PostgreSQL y los registros canónicos del sistema constituyen la
    fuente de verdad.
-   Los datos introducidos desde v1 deben sobrevivir a futuras
    actualizaciones.
-   La exactitud financiera y la trazabilidad tienen prioridad sobre la
    comodidad de implementación.
-   Los valores monetarios oficiales confirmados de la casa de apuestas
    tienen prioridad sobre cálculos teóricos.
-   La IA es un asistente de captura; nunca tiene autoridad para
    producir efectos financieros sin confirmación humana.
-   Los filtros y dashboards analizan información existente; nunca
    crean, eliminan ni alteran datos financieros.
-   Las eliminaciones ordinarias serán lógicas y recuperables.
-   Las reglas de autorización se aplican en backend, no solamente en la
    interfaz.

------------------------------------------------------------------------

# PARTE A --- NÚCLEO DEL SISTEMA

## 2. Usuarios

Cada persona tendrá una cuenta individual con, como mínimo:

-   ID permanente.
-   Nombre.
-   Apellido.
-   Correo electrónico.
-   Contraseña almacenada mediante hash seguro.
-   Avatar o fotografía opcional.
-   Estado de cuenta.
-   Fecha de creación.
-   Último acceso cuando corresponda.

El ID del usuario es su identidad canónica. Cambiar nombre o correo no
rompe la atribución histórica de apuestas, movimientos o acciones.

Si un usuario abandona un proyecto, es expulsado o posteriormente vuelve
a incorporarse con la misma cuenta, su historial permanece asociado a la
misma identidad.

## 3. Inicio de sesión y sesiones

El acceso inicial será mediante correo electrónico y contraseña.

El formulario incluirá **Mantener sesión iniciada**.

-   Activado: sesión persistente apropiada para un dispositivo de
    confianza.
-   Desactivado: sesión temporal con expiración/inactividad.
-   No se dependerá de detectar que una pestaña se cerró durante
    exactamente dos minutos, porque no es un mecanismo fiable entre
    navegadores y dispositivos.
-   El usuario podrá cerrar sesión.
-   La arquitectura permitirá gestionar y revocar sesiones abiertas.
-   La recuperación de contraseña formará parte del sistema.

## 4. Roles y permisos

Roles iniciales:

### 4.1 Administrador Global

Nivel máximo del sistema. Puede administrar usuarios, proyectos, roles
globales, solicitudes de eliminación, restauraciones y acciones
globales. Puede acceder a todos los proyectos cuando sea necesario.

### 4.2 Administrador de Proyecto

Administra un proyecto concreto: miembros, invitaciones, etapas, casas,
finanzas, apuestas, papelera y configuración.

### 4.3 Colaborador

Usuario operativo. Puede registrar apuestas, consultar información
autorizada y modificar sus propias apuestas. Sus eliminaciones están
sujetas a límites operativos.

### 4.4 Lector

Acceso de consulta, sin capacidad de modificación.

### 4.5 RBAC

Roles y permisos estarán separados internamente. La arquitectura
permitirá roles personalizados globales y roles personalizados
específicos de proyecto. La interfaz avanzada para personalizarlos puede
quedar fuera del núcleo inicial si retrasa el MVP.

## 5. Proyectos

Los proyectos aíslan equipos, banca, casas, etapas, apuestas,
movimientos y auditoría.

Un usuario solo ve proyectos a los que pertenece, salvo el Administrador
Global.

Al crear un proyecto:

1.  El creador se convierte en propietario.
2.  Se crea automáticamente Etapa 1.
3.  Se configura la unidad inicial.
4.  Se registra la banca inicial.
5.  Se distribuye el 100 % de la banca entre casas.
6.  El proyecto queda operativo.

Datos principales:

-   Nombre.
-   Descripción.
-   Imagen.
-   Propietario.
-   Moneda.
-   Zona horaria.
-   Formato de fecha.
-   Estado.
-   Fecha de creación.

Moneda inicial: **PEN --- Sol peruano**. La arquitectura quedará
preparada para otras monedas.

Formato de fecha predeterminado: **DD/MM/YYYY**.

## 6. Propiedad y membresías

El creador es propietario del proyecto. Administrar un proyecto no
equivale a poder destruirlo definitivamente o transferir su propiedad.

La eliminación definitiva del proyecto y la transferencia de propiedad
quedan bajo control del Administrador Global.

Un usuario puede pertenecer a múltiples proyectos y tener un rol
diferente en cada uno.

## 7. Invitaciones

El Administrador de Proyecto podrá generar enlaces de invitación.

Vencimientos disponibles:

-   24 horas.
-   7 días.
-   15 días.
-   30 días.
-   Sin vencimiento hasta desactivación manual.

El enlace puede ser:

-   De un solo uso.
-   Reutilizable.

Opcionalmente puede restringirse a un correo específico.

El administrador define el rol de ingreso.

Flujo:

-   Sin cuenta: enlace → registro → invitación → aceptar/rechazar.
-   Con cuenta pero sin sesión: enlace → login → invitación.
-   Con sesión activa: enlace → invitación.

El invitado no necesita conocer la configuración interna del enlace.

El panel mostrará invitaciones activas, expiradas, deshabilitadas y
aceptadas. Creación, aceptación, rechazo y deshabilitación quedan
auditadas.

## 8. Eliminación de cuenta

El usuario solicita eliminación. Solo el Administrador Global puede
aprobarla.

Antes de aprobar:

-   Se advierte que se perderá el acceso.
-   El historial financiero y operativo permanecerá.
-   Se requiere una acción segura/reautenticación del Administrador
    Global.

No se realizará eliminación física de la identidad histórica. La cuenta
queda eliminada/deshabilitada lógicamente.

## 9. Eliminación de proyecto

Un proyecto eliminado pasa a papelera durante **90 días**. Durante ese
periodo conserva todas sus relaciones y puede restaurarse.

La eliminación definitiva está reservada al Administrador Global. La
retención y la purga se rigen por el §89.

## 10. Auditoría del núcleo

Se registrarán acciones relevantes: creación de proyectos, invitaciones,
aceptación/rechazo, cambios de rol, expulsiones, etc.

La auditoría identificará usuario, proyecto, acción, registro afectado,
fecha/hora y valores anterior/nuevo cuando corresponda. Los registros de
auditoría no serán editables como datos ordinarios.

------------------------------------------------------------------------

# PARTE B --- OPERACIÓN, APUESTAS Y FINANZAS

## 11. Etapas

Cada proyecto comienza con **Etapa 1**.

Las etapas representan periodos de estrategia de banca/stake. No son
rondas y no reinician el capital.

-   Solo una etapa puede estar activa a la vez.
-   Su duración es libre.
-   La banca continúa de una etapa a otra.
-   El nombre predeterminado será Etapa 1, Etapa 2, etc., con
    posibilidad de nombre personalizado.
-   Cada etapa mantiene una banca inicial/de referencia para análisis
    histórico.
-   Cambiar de etapa no obliga a redistribuir saldos entre casas.

El colaborador trabaja normalmente sobre la etapa actual.
Administradores autorizados pueden navegar y operar sobre etapas
anteriores cuando las reglas lo permitan.

## 12. Unidad de stake

Cada etapa tiene una única unidad monetaria global para todas las casas.

**Monto teórico = stake × unidad de la etapa**

El stake es un multiplicador numérico, nunca un porcentaje.

Ejemplo: unidad S/10; stake 1.5 → monto teórico S/15.

### 12.1 Corrección de unidad

Un Administrador de Proyecto o Global puede corregir una unidad
configurada erróneamente.

Antes de confirmar se muestra:

-   Unidad actual.
-   Nueva unidad.
-   Número de apuestas afectadas.
-   Impacto previsto.

El cambio queda auditado y recalcula valores derivados de las apuestas
de la etapa, conforme a las reglas y límites del §73.

No existirá una segunda `unit_stake_used` autoritativa por apuesta que
impida esta corrección.

**Excepción fundamental:** si una apuesta posee un monto oficial
confirmado desde la casa/ticket, dicho monto es la autoridad financiera
y no se sobrescribe simplemente por `stake × unidad`.

## 13. Casas de apuestas

Las casas son cuentas financieras por proyecto. La misma casa puede
existir independientemente en proyectos distintos.

-   Principales inicialmente: Betano y Betsafe.
-   Se pueden añadir más.
-   Una casa puede permanecer activa con saldo cero.
-   Una casa con saldo no puede eliminarse arbitrariamente; primero debe
    quedar en cero mediante movimientos válidos y luego desactivarse.

## 14. Banca inicial

Al crear el proyecto se introduce el capital inicial y se distribuye el
100 % entre las casas configuradas.

El capital inicial queda registrado como movimiento financiero para
mantener trazabilidad.

No se crean saldos sin origen contable.

## 15. Nueva casa posteriormente

El saldo inicial de una casa añadida posteriormente debe proceder de:

-   Transferencia desde otra casa, o
-   Nuevo depósito externo válido.

Nunca se crea dinero simplemente asignando un saldo sin origen.

## 16. Movimientos financieros

Tipos principales:

-   Capital inicial.
-   Depósito.
-   Retiro.
-   Transferencia interna.
-   Movimiento extraordinario real.

Cada movimiento estará relacionado, cuando corresponda, con proyecto,
casa, etapa, usuario, fecha, estado y motivo.

### 16.1 Depósitos

Dinero externo que entra al proyecto. Solo administradores autorizados
pueden registrarlos.

Aumentan el capital, pero no cuentan como ganancias de apuestas.

### 16.2 Retiros

Dinero que sale del proyecto.

-   El administrador inicia.
-   Requieren aprobación (ver §79).
-   Reservan el monto desde la solicitud y solo se convierten en salida
    definitiva de la banca al aprobarse (ver §79).
-   No pueden exceder el saldo disponible.
-   Mientras el proyecto esté activo, el flujo ordinario no permitirá
    retirar deliberadamente el 100 % del capital.
-   El retiro total corresponde al cierre del proyecto.
-   Requieren motivo y auditoría.

### 16.3 Transferencias internas

Movimiento entre casas.

-   No altera el capital total.
-   No cuenta como depósito, retiro, ganancia ni pérdida.
-   Debe ser atómico: origen y destino se actualizan juntos o no se
    actualiza ninguno.
-   Queda auditado.

### 16.4 Movimientos extraordinarios

Solo representan hechos reales de la casa que no sean apuestas, por
ejemplo cashback, bonificación, comisión o corrección oficial.

No existe un "ajuste de saldo" genérico para esconder errores de LetFer.

## 17. Saldo disponible y comprometido

Una apuesta pendiente compromete inmediatamente su monto.

**Disponible = saldo financiero utilizable menos dinero comprometido.**

El dinero pendiente no puede reutilizarse. LetFer nunca permitirá saldo
disponible negativo.

Las definiciones financieras de referencia (saldo disponible,
comprometido, capital actual) están en el §92, y la comparación contra
la casa en el §80.

## 18. Apuestas

Cada apuesta pertenece obligatoriamente a:

-   Proyecto.
-   Etapa.
-   Casa.
-   Usuario creador.

Conserva, entre otros:

-   Fecha real de colocación.
-   Hora real si existe.
-   Fecha/hora real de liquidación cuando exista (ver §71).
-   Fecha/hora de registro en LetFer.
-   Stake.
-   Monto oficial.
-   Cuota visible.
-   Resultado.
-   Selecciones.
-   Observaciones.
-   Ticket opcional.

La fecha principal es la fecha real de colocación, no la fecha de
registro.

La lista principal se ordena por fecha/hora real, normalmente de más
reciente a más antigua. Si la hora no existe se utiliza un criterio
estable de desempate.

## 19. Selecciones

Cada selección puede contener:

-   Deporte.
-   Evento.
-   Mercado.
-   Selección.
-   Cuota individual visible.
-   Orden.
-   Tipo interno cuando resulte útil.

El evento será texto libre en v1. No se normalizan equipos.
Liga/competición queda fuera del MVP.

## 20. Tipos de apuesta

La clasificación se deriva de la estructura. El campo `betType` y su
precedencia frente a la IA se rigen por el §90:

### Simple

Un evento + una selección.

### Creada

Un evento + múltiples selecciones.

### Múltiple

Más de un evento.

Si una múltiple contiene una apuesta creada dentro de uno de sus
eventos, la clasificación principal continúa siendo **Múltiple**, aunque
el detalle interno puede conservar la estructura creada.

## 21. Resultados

Estados fijos (ver §78):

-   Pendiente.
-   Ganada.
-   Perdida.
-   Anulada/Cancelada.
-   Cash Out.

En v1 no habrá resultado financiero individual por selección. El
resultado final del ticket afecta al dinero.

Las fórmulas de 21.2 a 21.4 son los valores por defecto para casos
ordinarios. El retorno oficial es la autoridad financiera y, cuando
falta, se aplica el §77. Las liquidaciones especiales y el Cash Out se
rigen por el §78.

### 21.1 Pendiente

El monto queda comprometido. No existe ganancia/pérdida realizada. Puede
almacenarse un retorno potencial oficial si el ticket lo muestra.

### 21.2 Ganada

Se utiliza el retorno realizado oficial cuando esté disponible.

**Ganancia neta = retorno oficial realizado − monto oficial**

### 21.3 Perdida

Retorno = 0.\
Ganancia/pérdida = −monto oficial.

La cuota original sigue existiendo; no se convierte en 0.

### 21.4 Anulada

Retorno = monto oficial.\
Ganancia neta = 0.

Que retorno/monto sea 1 no significa que la cuota original fuese 1.00.

## 22. Precisión financiera

Regla crítica:

1.  Valores oficiales confirmados de la casa/ticket.
2.  Cálculos de LetFer como validación/referencia.
3.  Interpretación de IA como propuesta.

Se conservarán separadamente cuando existan:

-   Cuota oficial visible.
-   Monto oficial apostado.
-   Retorno potencial oficial.
-   Retorno realizado oficial.
-   Cuota efectiva derivada.
-   Ganancia/pérdida derivada.

Ejemplo:

-   Cuota visible: 1.95
-   Monto: S/100.00
-   Retorno oficial: S/195.48
-   Cuota efectiva derivada: 1.9548
-   Ganancia neta: S/95.48

La interfaz puede mostrar 1.95, pero el almacenamiento no destruye
precisión relevante.

La cuota efectiva es diagnóstica; no sustituye universalmente a la cuota
visible. Una apuesta perdida no tiene cuota 0 y una anulada no tiene
necesariamente cuota original 1.

Dinero y cuotas usarán tipos decimales exactos. No se utilizará `float`
para contabilidad.

## 23. Cuotas en múltiples

El producto de cuotas individuales visibles puede calcularse como
referencia.

Si la casa muestra una cuota total oficial, esa cuota tiene prioridad.

El retorno oficial tiene prioridad sobre cualquier retorno teórico
calculado desde la cuota visible.

## 24. Edición de apuestas

-   Administrador de Proyecto y Global: pueden editar apuestas del
    proyecto.
-   Colaborador: solo sus propias apuestas.
-   Lector: no edita.

Los cambios relevantes se auditan campo por campo con valor
anterior/nuevo, usuario y fecha.

Si una edición histórica cambia efectos financieros, se recalculan los
resúmenes afectados y se aplican las reglas del §74.

## 25. Movimiento entre etapas

Solo administradores autorizados.

Antes de mover se muestra etapa actual, destino, unidades e impacto.

Se recalculan valores derivados conforme a la etapa destino, respetando
los valores oficiales confirmados y las reglas del §74.

La fecha real de colocación no cambia.

## 26. Eliminación de apuestas

Eliminación lógica con papelera durante **90 días** (ver §89).

Se conserva quién eliminó, cuándo y motivo cuando corresponda.

Límites del colaborador:

-   Máximo 5 apuestas por acción masiva.
-   Máximo 10 eliminaciones por día.

Administradores no tienen esos límites operativos.

La restauración corresponde a administradores autorizados.

## 27. Integridad financiera

El backend debe garantizar:

-   Nunca saldo disponible negativo.
-   No reutilizar dinero comprometido.
-   No crear dinero sin movimiento válido.
-   Transferencias atómicas.
-   Protección contra concurrencia.
-   No duplicar depósitos/retiros mediante transferencias.
-   Ediciones históricas recalculan derivados.
-   Permisos comprobados en servidor.
-   Operaciones críticas transaccionales y auditadas.
-   No eliminar físicamente historial relacionado.
-   Resúmenes/cache reconstruibles y no autoritativos.

Principio central: **LetFer debe poder explicar de dónde salió, dónde
está y por qué cambió cada céntimo del proyecto.**

------------------------------------------------------------------------

# PARTE C --- TICKETS, IA, CONCILIACIÓN, CONTROL Y SEGURIDAD

## 28. Tickets

Una apuesta puede existir sin imagen. El ticket puede añadirse durante
el registro o posteriormente.

Entradas previstas:

-   Pegar captura con Ctrl+V.
-   Arrastrar y soltar.
-   Seleccionar archivo.
-   JPG/JPEG.
-   PNG.
-   PDF.

La imagen original se conserva asociada a la apuesta.

## 29. Lectura mediante IA

Flujo obligatorio:

**Ticket → IA → interpretación → formulario prellenado → revisión humana
→ confirmación → validación backend → registro**

La IA intentará extraer:

-   Casa de apuestas.
-   Fecha de colocación.
-   Hora, si aparece.
-   **Tipo de apuesta.**
-   Deporte.
-   Evento.
-   Mercado.
-   Selección/es.
-   Cuotas individuales visibles.
-   Cuota total visible.
-   Monto oficial apostado.
-   Retorno potencial/oficial.
-   Retorno realizado si aparece.
-   Resultado, si aparece.

No se requiere liga/competición ni número externo de ticket en v1.

La IA puede leer la etiqueta usada por la casa, pero LetFer también
analiza la estructura para proponer Simple, Creada o Múltiple. La IA
nunca tiene autoridad final sobre `betType` (ver §90).

## 30. Autoridad de la IA

La IA nunca modifica la banca directamente.

La confirmación humana es obligatoria antes de que los datos leídos
produzcan efectos financieros.

Se podrá conservar:

-   Imagen original.
-   Fecha/hora de análisis.
-   Usuario que subió.
-   Datos extraídos.
-   Confianza por campo cuando sea útil.
-   Correcciones realizadas.
-   Versiones/análisis sucesivos.

## 31. Ticket añadido a apuesta existente

Si se analiza un ticket de una apuesta ya registrada, LetFer compara los
datos manuales con los detectados.

Ante discrepancias muestra ambos y permite:

-   Actualizar.
-   Mantener.
-   Editar manualmente.

Nunca reemplaza silenciosamente información histórica.

## 32. Conciliación

La conciliación es requisito del MVP y funciona por casa.

El usuario introduce/confirma el saldo disponible oficial real de la
casa (ver §80).

LetFer compara:

-   Saldo disponible calculado por LetFer.
-   Saldo disponible oficial declarado.
-   Diferencia.
-   Última conciliación correcta.

### 32.1 Coincidencia

Si la diferencia es 0, se crea un **checkpoint de conciliación** con los
datos definidos en el §80 (entre ellos fecha/hora, saldo disponible
LetFer, saldo disponible oficial, comprometido y diferencia 0).

### 32.2 Discrepancia

Si no coinciden:

-   LetFer no altera el saldo.
-   No crea un ajuste falso.
-   Muestra la diferencia.
-   Muestra el último checkpoint correcto.
-   Permite **Revisar desde última conciliación**, mostrando solo
    apuestas y movimientos posteriores.

Esto reduce la búsqueda de errores.

## 33. Dashboard

Debe separar claramente:

### Estado financiero actual

-   Capital actual.
-   Disponible.
-   Pendiente/comprometido.
-   Distribución por casas.

### Análisis filtrado

Filtros posibles: - Etapa. - Periodo/fecha. - Casa. - Deporte. - Tipo. -
Usuario. - Resultado. - Stake.

Los filtros modifican el análisis, nunca la realidad financiera.

Indicadores principales (definiciones en el §92; separación de
extraordinarios en el §91):

-   Capital actual.
-   Disponible.
-   Pendiente.
-   Ganancia/pérdida de apuestas.
-   Depósitos.
-   Retiros.
-   Total de apuestas.
-   Ganadas.
-   Perdidas.
-   Pendientes.
-   Anuladas.

No se incluye stake promedio como métrica requerida.

## 34. Gráficos

Mínimo:

-   Evolución continua de banca.
-   Distribución por casas.

La evolución de banca no reinicia al cambiar de etapa. Los cambios de
etapa aparecen como marcadores.

Debe poder analizarse globalmente y por casa.

## 35. Auditoría

Acciones relevantes incluyen, entre otras:

-   Crear/editar/eliminar/restaurar apuesta.
-   Crear/cerrar etapa.
-   Cambiar unidad.
-   Mover apuesta de etapa.
-   Depósitos, retiros y transferencias.
-   Invitaciones, cambios de rol y expulsiones.
-   Correcciones derivadas de IA.
-   Restauraciones y operaciones administrativas.

Cuando corresponda se registran valor anterior y nuevo.

La auditoría puede incluir IP y dispositivo/sesión para acciones
relevantes.

Los logs no son editables/eliminables mediante flujos administrativos
ordinarios.

## 36. Papelera y recuperación

-   Apuestas: 90 días; tickets asociados siguen la misma retención.
-   Etapas: eliminación lógica conservando apuestas, movimientos,
    tickets e historial.
-   Proyectos: 90 días, conservando todo su contenido.

La restauración recompone las relaciones correspondientes.

El significado exacto de la retención de 90 días y la política de purga
se rigen por el §89.

## 37. Backups

-   Backup automático diario.
-   Referencia MVP: aproximadamente 30 generaciones diarias rotativas.
-   Los archivos/tickets tendrán estrategia compatible de respaldo.
-   El backup debe permitir reconstruir LetFer, no solo algunas tablas.

La estrategia previa a datos reales y de producción (incluida la
recuperación a un punto en el tiempo) se detalla en el §82.

Solo el Administrador Global puede restaurar backups.

Antes de una restauración importante:

1.  Backup preventivo del estado actual.
2.  Reautenticación.
3.  Confirmación fuerte.
4.  Restauración.
5.  Auditoría.

## 38. Recalcular balances

Herramienta administrativa para reconstruir resúmenes/cache desde los
registros canónicos.

No crea movimientos ni inventa dinero.

## 39. Seguridad y autorización

El frontend puede ocultar controles, pero la seguridad real se aplica en
backend.

Se validan en servidor:

-   Roles y permisos.
-   Propiedad de apuestas.
-   Límites de eliminación.
-   Movimientos financieros.
-   Cambios de etapa.
-   Restauraciones.
-   Acciones administrativas.

Operaciones especialmente sensibles pueden requerir reautenticación
mediante contraseña y confirmación explícita.

## 40. Concurrencia

El backend/base de datos debe revalidar saldos dentro de las
transacciones para evitar que dos usuarios gasten simultáneamente el
mismo dinero disponible.

## 41. Protección general

Desde v1:

-   Hash seguro de contraseñas.
-   Sesiones/tokens protegidos.
-   Bloqueo temporal ante intentos repetidos.
-   HTTPS en producción.
-   Validación de entradas.
-   Secretos fuera del repositorio.
-   Archivos privados y acceso autorizado.
-   Protección de concurrencia.
-   Auditoría.

2FA puede incorporarse posteriormente.

## 42. Archivos privados

Los tickets no tendrán URLs públicas permanentes.

El acceso debe comprobar proyecto y permisos, utilizando mecanismos
temporales/autorizados cuando corresponda.

------------------------------------------------------------------------

# PARTE D --- CONSTRUCCIÓN Y ALCANCE

## 43. Objetivo de LetFer v1

LetFer v1 debe ser utilizable en operación real:

**Login → proyecto → banca/casas → apuestas → tickets → liquidación →
dashboard → conciliación → colaboración → auditoría/recuperación**

La prioridad es funcionamiento, exactitud y persistencia antes que
perfección visual.

## 44. Stack tecnológico

-   Frontend: React + TypeScript.
-   Estilos: Tailwind CSS.
-   Backend: NestJS + TypeScript.
-   API: REST.
-   Base de datos: PostgreSQL.
-   Repositorio: monorepo.
-   Archivos: Object Storage.
-   IA: servicio desacoplado del proveedor.
-   Versionamiento: Git + GitHub.

Las versiones concretas se elegirán al iniciar el desarrollo usando
versiones estables y compatibles.

## 45. Estructura del repositorio

``` text
LetFer/
├── apps/
│   ├── web/
│   └── api/
├── packages/
│   └── shared/
├── docs/
│   └── ESPECIFICACION_LETFER_V1_1.md
├── README.md
└── ...
```

No se utilizarán microservicios innecesarios para el tamaño inicial del
sistema.

## 46. Módulos conceptuales del backend

-   auth
-   users
-   projects
-   members
-   roles
-   permissions
-   invitations
-   stages
-   betting-houses
-   financial-movements
-   transfers
-   reconciliation
-   bets
-   bet-selections
-   tickets
-   ai
-   audit
-   recycle-bin
-   admin

La organización física puede ajustarse técnicamente sin alterar estas
responsabilidades.

## 47. Entidades principales de datos

Como mínimo existirán entidades equivalentes a:

-   users
-   projects
-   project_members
-   roles
-   permissions
-   role_permissions
-   invitations
-   stages
-   betting_houses / house_accounts
-   financial_movements
-   internal_transfers
-   bets
-   bet_selections
-   ticket_files
-   ai_analyses
-   reconciliations
-   audit_logs
-   account_deletion_requests

Podrán añadirse tablas auxiliares por integridad o mantenibilidad.

No se creará un `bet_history` separado si duplica el propósito del audit
log.

## 48. Fuentes de verdad y datos derivados

Los registros canónicos alimentan cálculos y resúmenes.

Los caches/resúmenes:

-   No son una contabilidad paralela.
-   No son editables manualmente como fuente autoritativa.
-   Se actualizan transaccionalmente cuando corresponda.
-   Deben poder reconstruirse.

## 49. Pantallas funcionales del MVP

1.  Login.
2.  Mis proyectos.
3.  Dashboard del proyecto.
4.  Apuestas.
5.  Registrar/editar apuesta.
6.  Tickets e IA.
7.  Etapas.
8.  Casas y Finanzas.
9.  Miembros.
10. Administración y Configuración.

Los mockups aprobados son referencia funcional y de distribución, no
definición visual final.

## 50. Navegación principal

Dentro de un proyecto:

-   Dashboard.
-   Apuestas.
-   Etapas.
-   Casas y Finanzas.
-   Miembros.
-   Auditoría.
-   Configuración.

La cabecera identifica proyecto actual y etapa actual.

Las opciones visibles pueden variar por permisos.

## 51. Registro manual antes que IA

El registro manual debe funcionar completamente antes de integrar la IA.

La IA rellenará el mismo modelo/formulario y no creará un segundo flujo
financiero independiente.

## 52. Servicio de IA desacoplado

Conceptualmente:

``` text
TicketReader
  analyze(file)
      ↓
TicketAnalysis
```

Cambiar de proveedor de IA no debe obligar a reconstruir apuestas,
finanzas o frontend.

## 53. Contrato conceptual de lectura de ticket

Cuando estén disponibles:

``` text
house
placedDate
placedTime
betType

selections:
  sport
  event
  market
  selection
  visibleOdds

officialTotalOdds
officialAmount
officialPotentialReturn
officialRealizedReturn
result
```

Más metadatos de análisis cuando sean útiles.

## 54. Modelo financiero conceptual de apuesta

Debe distinguir, como conceptos separados:

-   stake
-   stage
-   official_amount
-   visible_total_odds
-   official_potential_return
-   official_realized_return
-   derived_effective_odds
-   derived_profit_loss

Los nombres finales pueden variar; la separación conceptual no.

## 55. Tiempos de una apuesta

Guardar separadamente:

-   `placed_at`: cuándo ocurrió realmente.
-   `settled_at`: cuándo la casa liquidó la apuesta (ver §71).
-   `created_at`: cuándo se registró en LetFer.
-   `updated_at`: última modificación.

Esto permite importar historial sin falsear fechas. El manejo de zonas
horarias y fechas sin hora se rige por el §93.

## 56. Precisión de almacenamiento

PostgreSQL utilizará tipos decimales adecuados para dinero y cuotas.

La precisión de almacenamiento no depende del número de decimales
mostrados en UI.

## 57. Transacciones

Operaciones financieras con múltiples efectos deben ser transaccionales
y realizar rollback completo ante error.

## 58. Capas de validación

-   Frontend: ayuda al usuario.
-   Backend: aplica reglas de negocio y autorización.
-   Base de datos: protege integridad fundamental.

Nunca se confía únicamente en React.

## 59. Dashboard desde backend

El backend proporciona resúmenes, estadísticas, series temporales y
distribuciones. El frontend no reconstruye por su cuenta toda la
contabilidad descargando todos los registros.

Esto permite reutilizar la lógica en una futura app móvil.

## 60. Rendimiento

No se sobreoptimizará v1.

Sí se utilizarán:

-   Índices adecuados.
-   Paginación.
-   Filtros en servidor.
-   Consultas eficientes.
-   Resúmenes reconstruibles cuando aporten valor.

## 61. Responsive

La web debe funcionar correctamente en desktop, tablet y móvil.

La app móvil independiente queda para una fase futura.

## 62. Diseño visual

Los mockups aprobados definen estructura y funcionamiento general.

No fijan definitivamente:

-   Colores.
-   Tipografía.
-   Espaciados.
-   Iconografía.
-   Animaciones.
-   Identidad gráfica.

La estética se afina después de asegurar funcionamiento.

## 63. Alcance incluido en LetFer v1

Incluye:

-   Cuentas, registro/login y recuperación.
-   Mantener sesión iniciada.
-   Proyectos.
-   Miembros y roles base.
-   Invitaciones.
-   Etapas.
-   Unidad de stake.
-   Casas.
-   Banca inicial.
-   Depósitos.
-   Retiros.
-   Transferencias.
-   Apuestas manuales.
-   Simples, creadas y múltiples.
-   Edición y eliminación lógica.
-   Tickets.
-   Lectura mediante IA.
-   Confirmación humana.
-   Liquidación.
-   Precisión financiera oficial.
-   Dashboard.
-   Filtros.
-   Gráficos principales.
-   Conciliación.
-   Auditoría.
-   Papelera.
-   Backups.
-   Administración global necesaria.
-   Web responsive.

## 64. Fuera del núcleo inicial / futuro

Preparado para incorporar después:

-   Aplicación móvil independiente.
-   2FA avanzado.
-   Login con Google u otros proveedores.
-   Automatización total de resultados.
-   Integraciones directas con casas.
-   Resultado individual por selección.
-   Analítica avanzada.
-   IA de conciliación desde historiales/capturas de la casa.
-   Personalización visual extensa.
-   Interfaz avanzada de roles personalizados.
-   Soporte sofisticado multimoneda.

Estas funciones no deben retrasar v1.

## 65. Migración del Excel

El archivo histórico se importará solo después de que el modelo LetFer
esté funcionando.

Flujo:

**Excel → lectura → transformación → validación → vista previa →
importación → verificación de saldos**

Nunca se importa historial a ciegas.

## 66. Estrategia de pruebas

Cada fase sigue:

**Implementar → probar → corregir → confirmar → siguiente fase**

Casos financieros obligatorios incluyen:

-   Ganada.
-   Perdida.
-   Pendiente.
-   Anulada.
-   Depósito.
-   Retiro.
-   Transferencia.
-   Edición histórica.
-   Cambio de etapa.
-   Corrección de unidad.
-   Concurrencia entre usuarios.
-   Cuota visible distinta de precisión efectiva.
-   Restauración/recalculo cuando corresponda.

## 67. Orden de construcción

### Fase 0 --- Preparación

Documentación, monorepo y entorno.

### Fase 1 --- Base

PostgreSQL, usuarios y autenticación. Incluye la infraestructura
transversal mínima de auditoría, borrado lógico, seguridad y timestamps
(ver §81 y §102).

### Fase 2 --- Colaboración

Proyectos, miembros, roles e invitaciones.

### Fase 3 --- Finanzas

Etapas, casas y movimientos financieros.

### Fase 4 --- Apuestas

Apuestas, selecciones y liquidaciones.

### Fase 5 --- Análisis

Dashboard, filtros y gráficos.

### Fase 6 --- Conciliación

Checkpoints y revisión desde última conciliación.

### Fase 7 --- Tickets e IA

Carga de archivos, lectura, comparación y confirmación.

### Fase 8 --- Administración

Interfaces y herramientas completas de auditoría, papelera y
administración, sobre la infraestructura construida desde la Fase 1
(ver §81 y §102).

### Fase 9 --- Migración

Importación controlada del Excel histórico.

### Fase 10 --- Pruebas reales

Uso operativo, corrección de flujos y validación financiera. Requiere
un respaldo funcional previo (ver §82).

### Fase 11 --- Producción

Despliegue, HTTPS, backups y configuración final.

## 68. Forma de trabajo con Claude Code

Claude Code debe recibir esta especificación como fuente de verdad y
tareas acotadas por fase.

Reglas de trabajo:

-   Leer esta especificación antes de implementar funcionalidad.
-   Trabajar únicamente sobre el alcance solicitado.
-   No inventar reglas de negocio contradictorias.
-   No cambiar decisiones financieras sin aprobación.
-   Ejecutar pruebas relevantes.
-   Informar archivos creados/modificados, migraciones, pruebas y
    problemas.
-   Mantener documentación y código sincronizados.

No se solicitará construir toda la aplicación en una sola instrucción.

## 69. Cambios futuros

La especificación puede evolucionar.

Proceso:

**Detectar necesidad → definir comportamiento → actualizar
especificación → implementar → probar**

No se debe permitir que documentación y sistema evolucionen en
direcciones contradictorias.

## 70. Criterio de LetFer v1 listo

LetFer v1 estará listo cuando pueda completar de forma estable y
trazable el ciclo:

**Crear proyecto → configurar banca → distribuir casas → registrar
apuestas → resolver apuestas → mover dinero → consultar resultados →
conciliar con la casa → saldo LetFer coincide con la realidad**

El criterio principal no es que todas las pantallas sean visualmente
perfectas, sino que el sistema sea operativo, exacto, seguro y
recuperable.

------------------------------------------------------------------------

# REGLAS CRÍTICAS PARA IMPLEMENTACIÓN

Estas reglas no deben reinterpretarse sin actualizar primero esta
especificación:

1.  **Stake es un multiplicador numérico, no un porcentaje.**
2.  **Solo existe una unidad de stake por etapa y proyecto.**
3.  **El cambio de etapa no reinicia la banca ni obliga a redistribuir
    casas.**
4.  **Los valores monetarios oficiales confirmados de la casa tienen
    prioridad sobre cálculos teóricos.**
5.  **La cuota visible no debe redondearse destructivamente en
    almacenamiento.**
6.  **La cuota efectiva derivada es diagnóstica, no reemplaza
    universalmente la cuota visible.**
7.  **No utilizar `float` para contabilidad.**
8.  **Una apuesta pendiente compromete saldo inmediatamente.**
9.  **Las transferencias internas no cuentan como depósitos, retiros,
    ganancias ni pérdidas.**
10. **No crear ajustes falsos para cuadrar conciliaciones.**
11. **La IA propone; el usuario confirma; el backend valida; recién
    entonces se registra.**
12. **La IA debe contemplar `betType` además de los demás datos del
    ticket.**
13. **Los filtros del dashboard no modifican la realidad financiera.**
14. **Las eliminaciones ordinarias son lógicas y recuperables.**
15. **Los permisos se validan en backend.**
16. **Las operaciones financieras críticas son transaccionales y
    auditadas.**
17. **Los resúmenes/cache no son fuente de verdad y deben poder
    reconstruirse.**
18. **La fecha real de colocación y la fecha de registro en LetFer son
    datos distintos.**
19. **No introducir liga/competición, número externo de ticket, stake
    promedio o resultado individual por selección en el MVP salvo cambio
    explícito de esta especificación.**
20. **La exactitud financiera y la trazabilidad prevalecen sobre atajos
    de implementación.**

------------------------------------------------------------------------

# ADENDA CONSOLIDADA v1.1 --- DECISIONES PREVIAS A IMPLEMENTACIÓN

**Estado:** Aprobada.\
**Regla de precedencia:** Si alguna regla anterior de este documento
contradice esta adenda, **prevalece esta adenda**. Durante la
implementación, estas reglas deben tratarse como parte integral de la
especificación maestra.

**Índice de precedencia.** Cláusulas del cuerpo cuyo detalle fue
precisado o reemplazado por esta adenda (el cuerpo ya incluye la
referencia cruzada correspondiente):

| Cláusula del cuerpo | Tema | Prevalece |
|---|---|---|
| §9, §26, §36 | Retención de 90 días y purga | §89 |
| §12.1 | Corrección de unidad | §73 |
| §16.2 | Retiros | §79 |
| §17 | Disponible y comprometido | §80, §92 |
| §18, §55 | Tiempos de la apuesta | §71, §93 |
| §20, §29 | Clasificación de `betType` | §90 |
| §21 | Estados y liquidaciones | §77, §78 |
| §24, §25 | Ediciones y movimientos históricos | §74 |
| §32 | Conciliación | §80 |
| §33 | Métricas del dashboard | §91, §92 |
| §37 | Backups | §82 |
| §3, §8, §84 | Sesiones, cuentas, registro y recuperación | §104 |
| §4 a §7, §9, §85, §87, §88, §98 | Proyectos, roles, membresías e invitaciones | §105 |
| §67 | Orden de construcción | §81, §102 |

## 71. Fecha de liquidación

Además de la fecha/hora real de colocación y de los timestamps internos,
una apuesta tendrá:

-   `placed_at`: fecha/hora real de colocación.
-   `settled_at`: fecha/hora real en que la casa liquidó la apuesta.
-   `created_at`: fecha/hora de registro en LetFer.
-   `updated_at`: última modificación.

`settled_at` es nulo mientras la apuesta esté pendiente.

Si el usuario conoce la fecha de liquidación pero no la hora exacta, el
modelo deberá conservar esa incertidumbre sin inventar una hora oficial.
La implementación podrá usar campos separados de fecha/hora o metadatos
equivalentes.

La evolución financiera y las conciliaciones deben considerar cuándo
ocurrió realmente cada efecto financiero.

## 72. Ledger financiero unificado

LetFer utilizará un **ledger financiero unificado** para representar los
efectos monetarios de todos los hechos que cambian saldos.

Incluye, entre otros:

-   Capital inicial.
-   Depósitos.
-   Retiros aprobados.
-   Transferencias.
-   Colocación de apuestas.
-   Liquidación/retorno de apuestas.
-   Movimientos extraordinarios reales.

Las entidades de negocio, como `bets`, conservan toda su información
propia. El ledger representa sus efectos monetarios y mantiene
referencia a la entidad que los originó.

Los saldos autoritativos se reconstruyen desde registros canónicos y sus
efectos contables. Podrán existir balances/resúmenes materializados para
rendimiento, pero serán cachés reconstruibles y nunca una segunda fuente
de verdad.

`Recalcular balances` reconstruye dichos resúmenes desde el historial
canónico y no crea movimientos ficticios.

Una transferencia se representa como una operación lógica única con
efectos débito/crédito vinculados y atómicos.

## 73. Corrección de unidad de etapa

Cambiar la unidad de una etapa:

-   Recalcula valores teóricos/derivados dependientes de la unidad.
-   Nunca modifica automáticamente un `official_amount` confirmado.
-   Nunca modifica automáticamente retornos oficiales confirmados.
-   Nunca reescribe movimientos financieros históricos basados en
    valores oficiales.
-   Si una apuesta carece de monto oficial confirmado, su monto
    calculado puede cambiar.
-   Si el cambio sobre apuestas pendientes provoca insuficiencia de
    saldo disponible, se rechaza la modificación y se identifican los
    conflictos.
-   Los checkpoints basados exclusivamente en valores oficiales no
    cambian por una simple corrección de valores teóricos.

No existirá un `unit_stake_used` autoritativo por apuesta que compita
con la unidad de la etapa.

## 74. Correcciones históricas y conciliaciones

Una edición, eliminación lógica, restauración, cambio de etapa u otra
corrección histórica con efecto monetario:

1.  Se audita.
2.  Reconstruye/recalcula los saldos afectados.
3.  Detecta checkpoints de conciliación posteriores cuyo resultado
    dependía de los datos modificados.
4.  Conserva esos checkpoints en el historial, pero los marca como
    **invalidados/desactualizados por modificación posterior**.
5.  Marca la casa como **Requiere nueva conciliación** cuando
    corresponda.
6.  Nunca crea un ajuste artificial para conservar una coincidencia
    anterior.

Si la modificación produciría una secuencia financieramente imposible
respecto de operaciones posteriores, LetFer bloquea la operación y
explica los registros que generan el conflicto. El administrador debe
corregir primero el historial real.

## 75. Apuesta real con saldo insuficiente en LetFer

La existencia real de una apuesta en la casa no autoriza a LetFer a
inventar saldo ni permitir un saldo disponible negativo.

Si una apuesta real no puede registrarse por insuficiencia de saldo
calculado:

-   Se informa la discrepancia.
-   La apuesta no produce todavía efectos financieros en LetFer.
-   Debe identificarse y registrar/corregir primero el hecho real
    faltante: depósito, transferencia, movimiento extraordinario,
    apuesta anterior, corrección histórica u otro origen legítimo.
-   Después se registra la apuesta normalmente.

La migración histórica podrá utilizar un proceso especial de validación
previa para reconstruir secuencias sin depender de captura manual
estrictamente fila por fila.

## 76. Monto calculado y monto confirmado

Una apuesta manual puede registrarse sin ticket.

Si no existe monto oficial confirmado:

`calculated_amount = stake × stage.unit_stake`

Ese monto puede utilizarse financieramente, pero debe conservarse su
procedencia/estado de confirmación.

Conceptualmente se distinguirá entre:

-   Monto calculado.
-   Monto confirmado/oficial.
-   Fuente o estado de confirmación.

Un monto introducido y confirmado conscientemente por el usuario puede
convertirse en monto confirmado aunque no provenga de OCR.

Si posteriormente un ticket muestra un monto oficial distinto:

-   Se muestra la discrepancia.
-   No se reemplaza silenciosamente.
-   El usuario confirma o rechaza la corrección.
-   La corrección se audita.
-   Se recalculan efectos financieros y conciliaciones afectadas
    conforme a las reglas históricas.

## 77. Retorno calculado y retorno oficial

Una apuesta ganada puede liquidarse provisionalmente sin disponer
todavía del retorno oficial exacto.

Si falta retorno oficial:

`calculated_return = official_or_confirmed_amount × visible_total_odds`

Para PEN, el valor monetario operativo se redondea a 2 decimales usando
una política decimal explícita y consistente; nunca mediante coma
flotante binaria.

El retorno queda marcado como **calculado/no confirmado**.

Cuando se obtiene el retorno oficial:

-   Se compara con el calculado.
-   Si difiere, se solicita confirmación.
-   El oficial pasa a ser la autoridad.
-   Se audita la corrección.
-   Se recalculan saldos y conciliaciones afectadas.

No se confunde nunca un retorno calculado con uno oficial.

## 78. Resultados y liquidaciones especiales

Estados principales de apuesta en v1:

-   Pendiente.
-   Ganada.
-   Perdida.
-   Anulada/Cancelada.
-   Cash Out.

El retorno oficial es la autoridad financiera.

Para cash out:

`profit_loss = official_realized_return - official_amount`

Una liquidación especial ---por ejemplo media ganada/media perdida,
hándicap asiático o una múltiple con selección anulada--- no obliga en
v1 a implementar un motor completo de reglas por selección. Se conserva
la estructura y la información disponible, pero el efecto monetario se
basa en el retorno final reconocido por la casa.

Las fórmulas simplificadas de Ganada/Perdida/Anulada son defaults para
casos ordinarios, no restricciones capaces de sobrescribir un retorno
oficial válido.

## 79. Retiros pendientes y aprobación

Un retiro solicitado:

-   Entra en estado pendiente.
-   **Reserva inmediatamente el monto**, reduciendo el saldo disponible.
-   No se contabiliza como salida definitiva hasta su aprobación.
-   Si se rechaza/cancela, la reserva se libera.
-   Si se aprueba, se convierte en salida financiera efectiva.

Aprobación:

-   Un Administrador de Proyecto puede solicitar.
-   Si existe otro Administrador de Proyecto habilitado, el solicitante
    no aprueba su propia solicitud; puede aprobarla otro Administrador o
    el Administrador Global.
-   Si el proyecto solo dispone de un administrador apto, se permite
    autoaprobación con reautenticación, confirmación explícita y
    auditoría.
-   El Administrador Global puede aprobar según sus permisos globales.

La aprobación revalida todas las condiciones financieras dentro de la
transacción.

## 80. Conciliación contra saldo disponible oficial

La conciliación por casa compara:

-   **Saldo disponible calculado por LetFer**, contra
-   **Saldo disponible real/oficial mostrado por la casa** en ese
    momento.

El dinero comprometido en apuestas pendientes se conserva por separado
como dato diagnóstico y ya no forma parte del saldo disponible.

Un checkpoint correcto almacena al menos:

-   Casa.
-   Fecha/hora.
-   Saldo disponible LetFer.
-   Saldo disponible oficial.
-   Comprometido en LetFer.
-   Diferencia.
-   Usuario conciliador.
-   Estado del checkpoint.

Pueden confirmar conciliaciones:

-   Administrador de Proyecto.
-   Administrador Global.

Otros roles solo podrán hacerlo si en el futuro reciben permiso
explícito mediante RBAC.

## 81. Infraestructura de auditoría y borrado lógico

Aunque la interfaz completa de administración permanezca en la Fase 8,
la infraestructura necesaria para:

-   auditoría,
-   timestamps,
-   soft delete,
-   restauración,
-   referencias históricas,

debe construirse desde las primeras fases en las entidades que lo
necesiten.

No se pospondrá la integridad del historial hasta la Fase 8.

## 82. Backups antes de datos reales

La configuración de producción definitiva sigue en la Fase 11, pero
antes de comenzar pruebas con datos reales debe existir una estrategia
funcional de respaldo y restauración.

Para producción se evaluará, según el proveedor elegido:

-   backups diarios,
-   retención,
-   recuperación a un punto en el tiempo (PITR) cuando esté
    disponible/coste sea razonable,
-   respaldo coordinado de PostgreSQL y Object Storage.

La retención mínima inicialmente prevista de backups diarios sigue
siendo aproximadamente 30 generaciones, pero podrá mejorarse sin cambiar
el modelo funcional.

## 83. Bootstrap del Administrador Global

El primer Administrador Global se crea mediante un mecanismo de
bootstrap seguro y explícito, no mediante registro público.

La implementación preferida será un comando/seed administrativo
controlado por variables de entorno o mecanismo equivalente, ejecutado
una sola vez o de forma idempotente.

Nunca se almacenarán credenciales reales en Git.

## 84. Registro, invitaciones y recuperación

LetFer es privado.

-   La incorporación normal de nuevos usuarios será por invitación.
-   Puede existir una pantalla de registro, pero el alta operativa a
    proyectos se controla por invitación.
-   El primer Administrador Global se crea por bootstrap.
-   Recuperación de contraseña requiere un proveedor de correo; el
    proveedor concreto se elegirá cuando corresponda al despliegue.
-   La arquitectura de correo debe quedar desacoplada del proveedor.

Los tokens sensibles de invitación/recuperación se generan
criptográficamente y se almacena preferentemente su hash, no el token
reutilizable en texto plano.

Un administrador no puede conceder mediante invitación permisos que no
está autorizado a asignar.

## 85. Ciclo de vida de proyecto

Estados conceptuales:

-   ACTIVE
-   CLOSED
-   TRASHED

Proyecto ACTIVE: - operación normal; - no permite retiro ordinario
deliberado del 100 % si ello equivale al cierre.

Proyecto CLOSED: - no admite nuevas apuestas ordinarias; - permite
tareas administrativas, consulta, conciliación final y retiro/cierre
financiero según permisos; - puede reabrirse solo mediante acción
autorizada y auditada.

Proyecto TRASHED: - eliminado lógicamente durante la retención.

El cierre y reapertura son acciones auditadas.

## 86. Ciclo de vida de etapa

Estados conceptuales:

-   ACTIVE
-   CLOSED
-   TRASHED

Debe existir como máximo una etapa ACTIVE por proyecto, protegido
también a nivel de base de datos cuando sea viable.

No se permite iniciar una nueva apuesta operativa si el proyecto no
tiene una etapa activa.

Crear/activar una nueva etapa cierra la anterior de forma transaccional.

Eliminar lógicamente una etapa no elimina físicamente sus apuestas. La
etapa y sus relaciones pasan a estado recuperable conforme al modelo de
papelera.

Administradores autorizados pueden corregir registros de etapas
anteriores bajo las reglas de auditoría, integridad financiera y
conciliación ya definidas.

## 87. Propietario y Administrador de Proyecto

El propietario es una condición adicional a la membresía/rol.

Por defecto el propietario recibe capacidades de Administrador de
Proyecto, pero conserva atribuciones especiales de propiedad.

El Administrador Global controla:

-   transferencia definitiva de propiedad,
-   eliminación definitiva,
-   resolución de casos de cuenta eliminada del propietario.

Enviar un proyecto a papelera requiere propietario o permiso
administrativo explícito; la eliminación definitiva sigue reservada al
Administrador Global.

## 88. Matriz base de permisos

La implementación tendrá permisos granulares. Como base:

**Administrador Global** - Acceso global autorizado a todas las
funciones administrativas.

**Propietario/Administrador de Proyecto** - Ver finanzas y apuestas del
proyecto. - Administrar miembros, invitaciones, etapas, casas,
conciliaciones y configuración. - Crear/editar apuestas según reglas. -
Gestionar papelera del proyecto. - Gestionar movimientos financieros
autorizados.

**Colaborador** - Puede ver las apuestas y la información operativa del
proyecto necesaria para colaborar. - Puede crear apuestas. - Puede
editar/eliminar únicamente sus propias apuestas, sujeto a límites. - No
confirma conciliaciones ni ejecuta movimientos administrativos salvo
permiso futuro explícito. - La visibilidad de información financiera
sensible podrá granularizarse posteriormente por permiso sin cambiar el
modelo.

**Lector** - Solo consulta de la información que sus permisos permitan.

El límite diario de eliminaciones del colaborador se calcula usando la
zona horaria configurada del proyecto.

## 89. Retención y purga

"90 días en papelera" significa que los registros son restaurables
durante al menos ese periodo.

Al vencer:

-   no se realizará una purga irreversible automática sin una política
    explícita;
-   podrán pasar a estado elegible para purga;
-   la purga física, cuando se implemente, debe respetar obligaciones de
    auditoría, relaciones financieras y backups.

Los registros financieros/auditoría necesarios para explicar la historia
del sistema no se destruyen simplemente porque expire la papelera de una
entidad visible.

## 90. Clasificación de tipo de apuesta

`betType` se almacena para preservar la clasificación confirmada y
facilitar consultas, pero el backend valida que sea compatible con la
estructura de selecciones/eventos.

Precedencia:

1.  Estructura real confirmada.
2.  Elección/corrección humana.
3.  Propuesta de IA.

La IA nunca tiene autoridad final sobre `betType`.

Casos de sistemas/combinaciones no contemplados por
Simple/Creada/Múltiple quedan fuera del MVP y requerirán una extensión
explícita.

## 91. Movimientos extraordinarios y métricas

Los movimientos extraordinarios reales afectan la banca, pero se
muestran separados de:

-   ganancias/pérdidas de apuestas,
-   depósitos,
-   retiros,
-   transferencias.

No se mezclarán con el P/L de apuestas.

La curva de banca puede mostrar la evolución real total incluyendo
entradas/salidas externas, mientras que las métricas de rendimiento de
apuestas deben poder excluir depósitos, retiros, transferencias y
extraordinarios según la métrica.

## 92. Definiciones financieras del dashboard

Por casa/proyecto:

-   **Saldo disponible:** dinero actualmente utilizable para nuevas
    operaciones.
-   **Comprometido:** dinero reservado por apuestas pendientes y otras
    reservas explícitas, como retiros pendientes.
-   **Capital actual:** valor económico actualmente atribuido al
    proyecto según sus saldos disponibles + importes
    comprometidos/reservados que siguen perteneciendo al proyecto,
    evitando doble conteo.
-   **P/L de apuestas:** resultado neto generado exclusivamente por
    apuestas liquidadas.
-   **Depósitos:** capital externo ingresado.
-   **Retiros:** capital externo retirado y aprobado.
-   **Transferencias:** redistribución interna, efecto neto global 0.
-   **Extraordinarios:** cambios reales de casa no clasificados como
    apuestas/depósitos/retiros.

Las consultas del dashboard deben definir expresamente qué categorías
incluyen para evitar mezclar rendimiento con aportes de capital.

## 93. Zona horaria y fechas parciales

Cada proyecto tiene una zona horaria IANA configurada.

Los instantes conocidos con hora se almacenan de forma no ambigua
(preferentemente UTC en persistencia) y se presentan en la zona del
proyecto.

Si solo se conoce una fecha sin hora, no se inventará una hora como si
fuese oficial. El modelo deberá conservar que la hora es desconocida.

Para asignación histórica de etapa, se usa la etapa que corresponda al
momento/fecha real de colocación cuando pueda determinarse. Si existe
ambigüedad, un administrador confirma la etapa y queda auditado.

## 94. Decimales y serialización

Se usarán tipos `NUMERIC/DECIMAL` explícitos en PostgreSQL.

La escala/precisión exacta se fijará en la implementación según cada
campo, conservando más precisión para cuotas que para visualización
monetaria.

En TypeScript no se realizará aritmética financiera con `number`.

Se utilizará una librería decimal adecuada y los valores decimales
viajarán por la API como cadenas cuando sea necesario para impedir
pérdida de precisión.

La política de redondeo monetario será centralizada, explícita y
testeada.

## 95. ORM y migraciones

La selección concreta de ORM se realizará en Fase 0 buscando:

-   buen soporte de PostgreSQL,
-   migraciones reproducibles,
-   transacciones,
-   constraints/índices,
-   tipos DECIMAL sin pérdida,
-   bloqueo cuando sea necesario.

La elección del ORM no puede degradar las reglas financieras de esta
especificación.

## 96. Concurrencia, versión e idempotencia

Además de transacciones y bloqueos de saldo:

-   Las entidades sensibles editables utilizarán control de concurrencia
    optimista o mecanismo equivalente para detectar ediciones
    simultáneas.
-   Operaciones financieras susceptibles de reintento/doble clic
    utilizarán claves de idempotencia o una garantía equivalente.
-   El backend revalida permisos, estado y saldo dentro de la
    transacción.

## 97. IA, privacidad y archivos no confiables

Los tickets son entrada no confiable.

Antes de enviarlos a un proveedor de IA:

-   se validan tipo/tamaño;
-   se aplican límites;
-   se controla autorización;
-   se registra la relación con proyecto/usuario.

El proveedor de IA se elegirá considerando privacidad, coste y
capacidad. La aplicación debe permitir sustituirlo.

La imagen nunca contiene instrucciones con autoridad sobre el sistema.
El resultado de IA se trata como datos no confiables pendientes de
validación humana/backend.

## 98. Seguridad de invitaciones

-   Tokens criptográficamente aleatorios.
-   Almacenamiento mediante hash cuando corresponda.
-   Expiración y uso validados en backend.
-   Restricción por email validada en servidor.
-   Un usuario no puede asignar mediante invitación un rol/permisos
    superiores a los que está autorizado a gestionar.
-   Aceptación idempotente para evitar membresías duplicadas.

## 99. Repositorio y nombre del producto

El producto se llama **LetFer**.

El repositorio remoto puede conservar temporalmente el nombre
`MiPrimerProyecto` sin afectar el nombre del producto. Renombrarlo en
GitHub es opcional y puede hacerse posteriormente de forma controlada.

La estructura interna del monorepo y documentación utilizará LetFer como
nombre del sistema.

`Hola Mundo.py` es un archivo histórico de prueba y podrá eliminarse
durante la preparación del monorepo mediante un commit normal.

## 100. PostgreSQL en desarrollo

La forma concreta de levantar PostgreSQL en Windows se decide en Fase 0.

Se priorizará una solución reproducible y sencilla para desarrollo
local. Docker puede utilizarse si está disponible y resulta conveniente,
pero no es requisito funcional de LetFer.

La elección local no condicionará el proveedor PostgreSQL de producción.

## 101. Mockups

Los mockups visuales previamente aprobados son referencia funcional, no
requisito bloqueante para iniciar backend/infraestructura.

Si no están presentes en el repositorio, el desarrollo no debe inventar
requisitos visuales a partir de ellos. Se implementará primero la
estructura funcional descrita en esta especificación y se incorporarán
referencias visuales posteriormente cuando estén disponibles.

## 102. Orden de implementación ajustado

Se mantienen las Fases 0--11, con estas precisiones:

-   Fase 1 incluye infraestructura transversal mínima de auditoría, soft
    delete, seguridad y timestamps necesaria por las fases siguientes.
-   Fases 2--7 utilizan esa infraestructura desde el inicio.
-   Fase 8 construye las interfaces y herramientas administrativas
    completas sobre ella.
-   Antes de Fase 10 con datos reales debe existir respaldo funcional.
-   Fase 11 formaliza y endurece producción, HTTPS, backups/PITR y
    operación.

## 103. Regla final de consistencia

Ante cualquier duda durante la implementación:

1.  La realidad oficial de la casa confirmada por un humano prevalece
    sobre una estimación.
2.  No se inventa dinero.
3.  No se ocultan discrepancias con ajustes ficticios.
4.  No se sobrescribe silenciosamente historia.
5.  Toda corrección relevante queda trazable.
6.  Los saldos deben poder reconstruirse.
7.  La seguridad y permisos se validan en backend.
8.  La precisión financiera nunca depende de `float`.
9.  La IA nunca tiene autoridad financiera autónoma.
10. Si una nueva regla contradice esta especificación, primero se
    actualiza la especificación y luego el código.

## 104. Parámetros de cuentas y autenticación (Fase 1)

**Estado:** Aprobada.\
Precisa y completa los §2, §3, §8, §39, §41 y §84 con los valores
concretos que la Fase 1 necesita. Todos los valores numéricos son la
configuración por defecto y se implementan como parámetros de
configuración del backend, no como constantes dispersas en el código.

### 104.1 Registro de usuarios

En la Fase 1 no existe registro público. El único alta de usuario es el
bootstrap del primer Administrador Global (§83). El registro de nuevos
usuarios mediante invitación se incorpora en la Fase 2 (§7, §84).

### 104.2 Duración de las sesiones

-   Con **Mantener sesión iniciada**: expira tras 30 días sin actividad
    (ventana deslizante) y, en todo caso, a los 90 días desde el inicio
    de sesión.
-   Sin **Mantener sesión iniciada**: expira tras 1 hora sin actividad
    y, en todo caso, a las 12 horas desde el inicio de sesión. El
    navegador la trata como cookie de sesión.

### 104.3 Bloqueo temporal por intentos fallidos

5 intentos de acceso fallidos en un periodo de 15 minutos para un mismo
correo producen un bloqueo de 15 minutos. Un acceso correcto reinicia el
conteo. Los correos inexistentes reciben exactamente la misma respuesta
que los existentes, y las cuentas deshabilitadas o eliminadas no se
distinguen de una contraseña incorrecta.

### 104.4 Contraseñas y recuperación

-   La contraseña tiene entre 10 y 128 caracteres, sin reglas de
    composición, y no puede contener la parte local del correo
    electrónico.
-   El enlace de recuperación es válido durante 1 hora, es de un solo
    uso, y un enlace nuevo invalida los anteriores.
-   Al restablecer la contraseña se cierran todas las sesiones del
    usuario.
-   La solicitud de recuperación responde igual exista o no el correo.

### 104.5 Reautenticación

Una confirmación de contraseña por reautenticación (§39) se considera
vigente durante 5 minutos.

### 104.6 Estados de cuenta

`ACTIVE`, `DISABLED` y `DELETED`. Solo una cuenta `ACTIVE` puede iniciar
sesión. Pasar a `DISABLED` o `DELETED` invalida sus sesiones. La cuenta
nunca se elimina físicamente (§8).

### 104.7 Auditoría de autenticación

Se auditan: inicio de sesión correcto, activación de un bloqueo,
cierre de sesión, revocación de sesiones, cambio de contraseña,
solicitud y realización de un restablecimiento de contraseña, cambios de
perfil o correo, cambios de estado de cuenta y el bootstrap del
Administrador Global. Los intentos fallidos se registran como intentos
de acceso, no como entradas de auditoría, salvo el bloqueo resultante.

### 104.8 Rol global previo al RBAC

Hasta que la Fase 2 incorpore roles y permisos (§4.5), el usuario tiene
un rol de sistema con dos valores: `USER` y `GLOBAL_ADMIN`. (La Fase 2
lo sustituye por el rol global de la tabla de roles, §105.2.)

### 104.9 Cambio de correo

El usuario puede cambiar su correo confirmando su contraseña. No se
exige verificación mediante enlace. Se avisa al correo anterior. El
cambio se audita con el valor anterior y el nuevo y no altera la
atribución histórica (§2).

### 104.10 Alcance diferido

Quedan fuera de la Fase 1: la solicitud y aprobación de eliminación de
cuenta (§8) y la gestión de usuarios por el administrador (Fase 8), la
subida de avatar (Fase 7, requiere Object Storage) y las claves de
idempotencia (Fase 3). La Fase 1 solo deja el modelo de datos y el campo
de avatar.

### 104.11 Interfaz mínima de la Fase 1

La Fase 1 incluye las pantallas mínimas de Login, recuperación y
restablecimiento de contraseña y un contenedor autenticado provisional
(§49). Su diseño visual no es definitivo (§62).

## 105. Proyectos, miembros, roles e invitaciones (Fase 2)

**Estado:** Aprobada.\
Precisa y completa los §4 a §7, §9, §10, §85, §87, §88 y §98 con las
decisiones de la Fase 2. Si alguna regla anterior las contradice,
prevalece este apartado.

### 105.1 Quién puede crear proyectos

**Todo usuario activo con el rol global `USER` puede crear un proyecto
propio, y también el Administrador Global. Crear proyectos NO es una
facultad exclusiva del Administrador Global.** El permiso
`projects.create` pertenece a los roles globales `USER` y
`GLOBAL_ADMIN`.

Al crear un proyecto, en una única transacción:

-   El creador pasa a ser el propietario (`owner`) del proyecto.
-   Se crea su membresía como Administrador de Proyecto.
-   Se registra la auditoría de la creación.

En la Fase 2 la creación genera el proyecto, su propietario y su
membresía, en estado `ACTIVE`, pero todavía **sin** Etapa 1, unidad de
stake, banca inicial ni casas: esos pasos del §5 los incorpora la
Fase 3, que completará el flujo de creación.

### 105.2 Roles de sistema y permisos

Roles y permisos son datos separados (§4.5). Los roles de sistema son:

-   Globales: `GLOBAL_ADMIN` y `USER`.
-   De proyecto: `PROJECT_ADMIN`, `COLLABORATOR` y `READER`.
-   `PROJECT_OWNER`: rol implícito del propietario; no se asigna ni
    puede concederse mediante una invitación.

Los permisos efectivos de un usuario en un proyecto son la unión de los
de su rol global, los de su rol de membresía y, si es el propietario,
los de `PROJECT_OWNER`. Un Administrador Global tiene todos los
permisos en todos los proyectos (§4.1). La arquitectura admite roles
personalizados globales y de proyecto; su interfaz queda fuera de la
Fase 2.

| Permiso | Global Admin | Owner | Project Admin | Colaborador | Lector | USER |
|---|---|---|---|---|---|---|
| `projects.create` | sí | | | | | sí |
| `projects.list_all` | sí | | | | | |
| `projects.transfer_ownership` | sí | | | | | |
| `project.view` | sí | sí | sí | sí | sí | |
| `members.view` | sí | sí | sí | sí | sí | |
| `project.update` | sí | sí | sí | | | |
| `project.close` | sí | sí | sí | | | |
| `project.reopen` | sí | sí | | | | |
| `project.trash` | sí | sí | | | | |
| `project.restore` | sí | sí | | | | |
| `members.update_role` | sí | sí | sí | | | |
| `members.remove` | sí | sí | sí | | | |
| `invitations.view` | sí | sí | sí | | | |
| `invitations.create` | sí | sí | sí | | | |
| `invitations.disable` | sí | sí | sí | | | |

Un Administrador de Proyecto solo puede enviar un proyecto a papelera
si un rol personalizado le concede explícitamente `project.trash` (§87).

**Límite de asignación (§84, §98):** un rol solo puede asignarse
(mediante una invitación o un cambio de rol) si todos sus permisos están
incluidos en los permisos efectivos de quien lo asigna.

### 105.3 Aislamiento

Un usuario solo ve los proyectos a los que pertenece; el Administrador
Global ve todos (§5). Quien no es miembro ni tiene permiso global recibe
la misma respuesta que ante un proyecto inexistente. Un proyecto en
papelera solo es visible para quienes pueden restaurarlo.

### 105.4 Propietario y membresías

-   La membresía del propietario es siempre de Administrador de Proyecto
    y no puede quitarse ni degradarse; el propietario no abandona el
    proyecto. Lo protege también la base de datos.
-   Solo el Administrador Global transfiere la propiedad, con
    reautenticación (§39) y auditoría. El nuevo propietario debe ser
    miembro activo; el propietario anterior queda como Administrador de
    Proyecto.
-   Estados de una membresía: `ACTIVE`, `LEFT` (abandonó) y `REMOVED`
    (expulsado). Quien vuelve a incorporarse con su misma cuenta
    reutiliza su misma membresía: su historial permanece (§2).
-   Los correos de los miembros solo los ven quienes pueden administrar
    miembros; el resto ve nombre, rol y estado.

### 105.5 Ciclo de vida del proyecto

-   Cerrar: `ACTIVE` → `CLOSED` (propietario, Administrador de Proyecto
    y Global). Reabrir: `CLOSED` → `ACTIVE` (propietario y Global).
-   Papelera: `ACTIVE` o `CLOSED` → `TRASHED`; conserva el estado
    anterior, la fecha y el motivo, y queda restaurable al menos 90 días
    (§9, §89). Restaurar vuelve al estado anterior (propietario y
    Global). No hay purga automática.
-   Cerrar, reabrir, enviar a papelera y restaurar exigen
    reautenticación (§39) y se auditan.
-   Las invitaciones solo se crean y se aceptan en proyectos `ACTIVE`.

### 105.6 Datos del proyecto

Nombre (1 a 100 caracteres), descripción (hasta 2000), moneda `PEN` (no
modificable en esta versión), zona horaria IANA (por defecto
`America/Lima`, editable con auditoría) y formato de fecha (por defecto
`DD/MM/YYYY`). La imagen del proyecto se subirá con Object Storage
(Fase 7); la Fase 2 solo conserva su referencia.

### 105.7 Invitaciones

-   Vencimientos: 24 horas, 7, 15 o 30 días, o sin vencimiento hasta
    desactivación manual. Un solo uso o reutilizable. Restricción
    opcional a un correo. El rol de ingreso lo define quien invita,
    dentro del límite de asignación (§105.2).
-   El token se genera con 256 bits aleatorios, se muestra una sola vez
    al crear la invitación y en la base de datos solo se guarda su
    hash. Por eso el panel no puede volver a mostrar el enlace.
-   Estado (se calcula al consultar): `DISABLED` si fue deshabilitada;
    si no, `ACCEPTED` si es de un solo uso y ya se aceptó; si no,
    `EXPIRED` si venció; si no, `ACTIVE`.
-   Aceptar es idempotente: quien ya es miembro activo no duplica su
    membresía ni cambia su rol. Un enlace de un solo uso se consume de
    forma atómica. Rechazar solo se audita: no consume ni deshabilita el
    enlace.
-   Una invitación deja de ser válida si su creador ya no está
    autorizado a crearla o si el proyecto no está `ACTIVE`.
-   Registro por invitación (§84): sin cuenta, el enlace permite crear
    la cuenta (rol global `USER`); después el usuario acepta o rechaza
    la invitación. La restricción por correo se valida en el servidor.
-   Se auditan la creación, deshabilitación, aceptación y rechazo de
    invitaciones, los cambios de rol, las expulsiones, los abandonos y
    todos los cambios de estado del proyecto.

## 106. Etapas, casas y movimientos financieros (Fase 3)

**Estado:** Aprobada.\
Precisa y completa los §5, §11 a §17, §39, §49 y §72 a §79 con las
decisiones de la Fase 3 (D1 a D8). Si alguna regla anterior las
contradice, prevalece este apartado.

### 106.1 Configuración inicial del proyecto (D1)

`POST /projects` (Fase 2) solo crea el proyecto, su propietario y su
membresía. `POST /projects/:id/setup` completa la configuración
inicial en una única transacción: crea la Etapa 1 con su unidad de
stake, da de alta las casas indicadas y registra la banca inicial de
cada una como capital inicial (`INITIAL_CAPITAL`) en el ledger. Un
proyecto sin configurar existe (es visible, editable en sus datos
básicos) pero **no admite ninguna operación financiera** (movimientos,
retiros) ni la creación de etapas o casas adicionales hasta completar
el setup. El setup solo puede ejecutarse una vez; reintentarlo sobre un
proyecto ya configurado responde 409 `INVALID_STATE`.

### 106.2 Ledger financiero único (D2, D3, D4)

Todo movimiento de dinero del proyecto (capital inicial, depósito,
retiro, transferencia interna, extraordinario) se registra como una
fila en un único ledger (`financial_movements`). **Una fila confirmada
del ledger nunca se edita ni se borra**: cualquier corrección posterior
se hace con un movimiento nuevo, nunca modificando el existente. Esto
no afecta al ciclo de vida propio de una solicitud de retiro (§106.5),
que sí cambia de estado hasta su resolución: eso no es editar un
movimiento confirmado, es el flujo de aprobación anterior a que exista
uno.

Los saldos de una casa (saldo, comprometido y disponible) se calculan
en cada consulta sumando el ledger y descontando los retiros
`PENDING`; **no se guarda un saldo como caché**. Se prioriza la
integridad y la trazabilidad sobre la optimización prematura (si el
cálculo en consulta llegara a ser un problema de rendimiento, se
resolverá más adelante con una caché reconstruible, nunca convirtiendo
esa caché en fuente de verdad).

Una transferencia interna entre dos casas del mismo proyecto es **una
sola fila** del ledger con `from_house_id` y `to_house_id` (no dos
filas separadas de salida/entrada), identificada además por un
`operation_id` para poder correlacionarla en la auditoría. La
operación es atómica: afecta a las dos casas o a ninguna.

### 106.3 Casas de apuestas (D7)

El catálogo de casas es libre y propio de cada proyecto: cualquier
nombre es válido, sin un catálogo global compartido entre proyectos.
Una casa no se elimina físicamente (integridad financiera): solo se
desactiva y puede reactivarse. No requiere reautenticación crear una
casa nueva.

### 106.4 Movimientos financieros

-   **Depósito:** dinero externo que entra a una casa. No exige
    reautenticación.
-   **Transferencia interna:** ver §106.2. No exige reautenticación.
-   **Extraordinario:** un hecho real de la casa (cashback,
    bonificación, comisión, corrección oficial de la casa); nunca un
    "ajuste" genérico para cuadrar cifras. El motivo es obligatorio.
    Exige reautenticación (D6).

### 106.5 Solicitudes de retiro (D5)

Un retiro es una solicitud con su propio ciclo de vida en una tabla
separada (`withdrawal_requests`): `PENDING` → `APPROVED` (o
`REJECTED`, o `CANCELLED`). Solicitar un retiro reserva de inmediato su
monto (reduce el disponible de la casa, §17) sin tocar el ledger. Solo
al **aprobarse** se genera el movimiento definitivo (`WITHDRAWAL`) en
`financial_movements`; rechazar o cancelar libera la reserva sin dejar
rastro en el ledger. Aprobar exige reautenticación (D6) y control de
concurrencia optimista (`version`); revalida el disponible sobre la
casa bloqueada antes de confirmar, por si el estado cambió entre la
solicitud y la aprobación.

### 106.6 Reautenticación (D6, precisa §39)

Exigen `@RequireRecentAuth()`: aprobar un retiro, corregir la unidad de
una etapa (§12.1), registrar un movimiento extraordinario y transferir
la propiedad del proyecto (§105.4, ya vigente desde la Fase 2). No la
exigen: depósitos, transferencias internas, ni la creación de etapas o
casas.

### 106.7 Permisos (D8)

Un Colaborador solo tiene acceso de **consulta** a la información
operativa: ver etapas, ver casas y sus saldos, y ver el historial de
movimientos. No puede crear, aprobar ni modificar ningún dato
financiero (ni casas, ni movimientos, ni retiros) salvo que un rol
personalizado se lo conceda explícitamente (§105.2). El Lector solo
consulta. El Administrador de Proyecto y el propietario tienen todos
los permisos financieros del proyecto.

### 106.8 Auditoría

Se auditan la configuración inicial del proyecto, la creación y
activación de etapas, la corrección de unidad, la creación y
desactivación/reactivación de casas, todo movimiento financiero
(depósito, transferencia, extraordinario) y cada cambio de estado de
una solicitud de retiro (solicitud, aprobación, rechazo, cancelación).

## 107. Apuestas, selecciones y liquidaciones (Fase 4)

**Estado:** Aprobada.\
Precisa y completa los §18 a §27, §71, §73 a §78, §90 con las
decisiones de la Fase 4. Si alguna regla anterior las contradice,
prevalece este apartado.

### 107.1 Alcance y fuentes externas de decisión (D-T1)

La Fase 4 no modela tipster, señal externa ni recomendación previa: una
apuesta representa únicamente la decisión ya ejecutada por el usuario.
No existen tablas de tipsters ni de señales, ni campos de origen de la
apuesta. Analizar fuentes externas de decisión, si se necesita en el
futuro, será una extensión separada con su propio cambio de esta
especificación.

### 107.2 Estados de liquidación (D-B1, D-B2)

Los estados de una apuesta son `PENDING`, `WON`, `LOST`, `VOID` y
`CASHOUT`. **`VOID` es el único estado para "Anulada/Cancelada"**: ambos
representan financieramente una apuesta inválida sin ganancia ni
pérdida (retorno = monto oficial, §21.4).

Una apuesta `LOST` **no genera una fila `BET_SETTLEMENT`** en el
ledger: el `BET_PLACEMENT` ya representa la salida del dinero, y la
pérdida se determina por la ausencia de un retorno positivo asociado a
esa apuesta, no por un movimiento de $0.

### 107.3 Reserva de una apuesta pendiente y ledger (§17, §72)

Mientras una apuesta está `PENDING`, su monto (oficial si existe, si no
el calculado según §107.5) se refleja en el **comprometido** de la casa
(§17, §92) mediante una consulta en vivo sobre `bets`, igual que los
retiros pendientes (D5, Fase 3) — **no genera todavía ninguna fila del
ledger**.

Las filas `BET_PLACEMENT` (débito) y, cuando corresponda (§107.2),
`BET_SETTLEMENT` (crédito) se insertan **juntas, en la misma
transacción, al liquidar la apuesta**, cada una con el `occurredAt` que
le corresponde realmente (`placed_at` y `settled_at`), aunque ambas se
graben en la base de datos en ese mismo instante. El monto que queda
registrado en `BET_PLACEMENT` es el monto oficial si existe, o si no el
monto calculado vigente **en el momento de liquidar** — a partir de ahí
queda congelado (ledger inmutable, D2): una corrección posterior de la
unidad de la etapa ya no lo modifica.

### 107.4 Selecciones y tipo de apuesta (§19, §20, §90, D-B3)

Cada selección pertenece a un grupo de evento (`eventGroup`, entero):
selecciones con el mismo `eventGroup` pertenecen al mismo evento. El
backend valida `betType` contra la estructura real:

-   **Simple:** un único grupo de evento con una única selección.
-   **Creada:** un único grupo de evento con más de una selección.
-   **Múltiple:** más de un grupo de evento (cada uno con una o más
    selecciones; un grupo con varias reproduce internamente la
    estructura "Creada" sin cambiar la clasificación principal, §20).

### 107.5 Montos y retornos derivados (§54, §76, §77, D-B7)

`calculated_amount` y `derived_profit_loss` **no se almacenan**: se
calculan en cada lectura, igual que los saldos de casa (D3, Fase 3).

-   Monto efectivo = `official_amount` si existe; si no,
    `stake × stage.unit_stake` (redondeado, ADR 0004).
-   Retorno: `official_realized_return` si la apuesta está liquidada
    con retorno positivo (`WON`/`VOID`/`CASHOUT`); ausente si `LOST`
    (§107.2) o si sigue `PENDING`.
-   Ganancia/pérdida: sin liquidar, ninguna; `LOST`, `−monto efectivo`;
    en los demás casos liquidados, `retorno oficial − monto efectivo`.
-   Cuota efectiva derivada = `retorno oficial ÷ monto efectivo`
    (diagnóstica, nunca sustituye a `visible_total_odds`, regla crítica
    6).

Una corrección de unidad de etapa (§73) recalcula automáticamente el
monto efectivo de las apuestas `PENDING` sin monto oficial, sin ningún
job de migración, porque nada quedó guardado. **Queda pendiente de
definir** (no resuelto en esta fase) si la corrección debe además
rechazarse de forma proactiva cuando dejaría a una casa con
comprometido superior a su saldo; por ahora, esa situación se detecta
en la siguiente creación o liquidación de apuesta sobre esa casa (que sí
revalida disponible), no en la propia corrección de unidad.

### 107.6 Horas desconocidas y orden (§18, §55, §71, §93, D-B4)

`placed_at`/`settled_at` van acompañados de `placed_time_known`/
`settled_time_known` (booleanos): si la hora exacta no se conoce, el
componente de hora del timestamp no tiene autoridad y no debe
mostrarse ni tratarse como oficial. El criterio de desempate estable
cuando falta la hora es `created_at` y, si aún empata, `id`.

### 107.7 Permisos (§4.3, §88, D-B5, D-B6)

Ocho permisos nuevos: `bets.view`, `bets.create`, `bets.update_own`,
`bets.update_any`, `bets.trash_own`, `bets.trash_any`, `bets.restore`,
`bets.move_stage`. Una acción sobre una apuesta ajena exige el permiso
`_any`; sobre la propia (`created_by` = actor), basta el `_own`. Mover
de etapa y restaurar no tienen variante "propia" (§25, §26: siempre
administradores). El Colaborador recibe `view`, `create`, `update_own`
y `trash_own`; el Administrador de Proyecto y el propietario, los
ocho; el Lector, solo `view`.

El límite diario de eliminaciones del Colaborador (máximo 5 por acción,
máximo 10 al día, huso horario del proyecto, §26, §88) se calcula
contando sus acciones `bet.trashed` de auditoría del día, sin una tabla
de contadores separada. No existe un endpoint de papelera masiva: el
límite se aplica sobre llamadas repetidas al endpoint individual.

### 107.8 Redondeo pendiente de confirmar (D-B8)

La política `ROUND_HALF_UP` para montos y retornos calculados de
apuestas sigue siendo provisional (ADR 0004): se ajustará cuando existan
tickets reales de Betano/Betsafe que confirmen si la casa redondea o
trunca.

### 107.9 Fuera de esta fase

No forman parte de la Fase 4: tickets e IA (`ticket_file_id` no se
reserva todavía, Fase 7, D-B11), el estado "requiere nueva
conciliación" en `houses` (Fase 6, D-B12), dashboards/gráficos (Fase 5)
y la corrección de campos financieros (`status`, `official_amount`,
`official_realized_return`, `settled_at`) de una apuesta **ya
liquidada** (§77 completo: comparar retorno calculado vs. oficial y
recalcular tras liquidar) — mientras tanto, volver a liquidar o
cambiar esos campos de una apuesta liquidada responde 409.

## 108. Dashboard, métricas y gráficos (Fase 5)

**Estado:** Aprobada.\
Precisa y completa los §33, §34, §59 a §60, §91 y §92 con las
decisiones de la Fase 5 (D-M1 a D-M10). Si alguna regla anterior las
contradice, prevalece este apartado.

### 108.1 Yield y ROI (D-M1)

Son dos métricas distintas, no sinónimos:

-   **Yield** = P/L de apuestas ÷ monto efectivo total apostado en las
    apuestas liquidadas del filtro × 100. Mide el margen por cada sol
    arriesgado.
-   **ROI** = P/L de apuestas ÷ capital invertido × 100, donde capital
    invertido es la banca inicial más los depósitos netos del periodo
    filtrado. Mide el retorno sobre el capital comprometido.

### 108.2 Ubicación (D-M2)

El Dashboard **amplía la pantalla "Resumen"** existente (§49): no es
una pestaña nueva. La tarjeta de datos del proyecto se conserva; debajo
se añaden el estado financiero actual, los filtros, los indicadores y
los gráficos.

### 108.3 Dos series temporales distintas (D-M3, precisa el §91)

-   **Evolución de banca real**: incluye todo (capital inicial,
    depósitos, retiros, transferencias, liquidaciones de apuestas,
    extraordinarios). No reinicia al cambiar de etapa; los cambios de
    etapa aparecen como marcadores (§34).
-   **Curva de rendimiento**: acumulado exclusivo de las liquidaciones
    de apuestas (§91: excluye depósitos, retiros, transferencias y
    extraordinarios). Es la base del drawdown: mezclar capital
    aportado con rendimiento invalidaría la métrica.

### 108.4 Drawdown (D-M6)

Sobre la curva de rendimiento: en cada punto, `pico histórico hasta ese
punto − valor en ese punto`. Se expresa tanto en soles como en
porcentaje del pico (`drawdown ÷ pico × 100`). El drawdown máximo del
periodo filtrado es el mayor valor de esa serie.

### 108.5 Apuestas múltiples en los desgloses por deporte/mercado (D-M4)

Si todas las selecciones de una apuesta comparten el mismo
deporte/mercado, se agrupa normalmente. Si no, la apuesta cuenta en un
grupo **"Mixto"** separado: nunca se cuenta su P/L más de una vez en
distintos grupos (§92, evitar doble conteo).

### 108.6 Estados de apuesta en los conteos (D-M5)

Los conteos del dashboard distinguen Pendiente, Ganada, Perdida,
Anulada y **Cash Out** como bucket propio (el §33 no lo menciona
porque es anterior a la Fase 4; el estado ya existe desde entonces,
§21/§78, y agruparlo dentro de Ganada/Perdida según el signo de su P/L
perdería información).

### 108.7 Agrupación temporal (D-M7)

El rendimiento por periodo se agrupa por `settled_at` (cuándo se supo
el resultado, no cuándo se colocó la apuesta), en la zona horaria del
proyecto (§93). `placed_at` sigue siendo un filtro de fecha disponible,
pero no el eje de la agrupación temporal.

### 108.8 Permisos (D-M8)

No se crea un permiso `dashboard.view`. Los endpoints del dashboard
exigen la combinación `bets.view` + `houses.view` + `movements.view`:
todo rol de proyecto existente (Administrador, Colaborador, Lector) ya
la tiene, porque el dashboard solo deriva datos que esos permisos ya
permiten consultar por separado.

### 108.9 Sin tablas de resumen materializadas (D-M10)

Todas las métricas se calculan en consulta mediante SQL agregado
(`SUM`/`COUNT`/`GROUP BY`, funciones de ventana para las series
temporales y el drawdown), igual que los saldos de casa (D3, Fase 3) y
los montos/retornos de apuestas (D-B7, Fase 4). No se crea ninguna
tabla ni columna nueva: el dashboard deriva enteramente de `bets`,
`bet_selections`, `financial_movements`, `stages` y `houses`.

## 109. Confianza y recuperación (Fase 5.5)

**Estado:** Aprobada.\
Precisa y completa los §32, §37, §38, §72, §74, §80 y §82 con las
decisiones de la etapa "Confianza y recuperación", previa a la Fase 6
numerada (que queda contenida en el §109.1) y a cualquier uso con datos
reales. Si alguna regla anterior las contradice, prevalece este
apartado. Fuera de alcance: PITR, almacenamiento cloud específico,
coordinación con archivos/tickets e infraestructura definitiva de
producción (siguen en la Fase 11, §82).

### 109.1 Conciliación (D-C1 a D-C7, precisa §32 y §80)

Un checkpoint de conciliación se registra **siempre** que alguien la
intenta, coincida o no (D-C1): es un registro histórico de
comparación, nunca un ajuste financiero. No modifica saldos, no crea
movimientos y no corrige datos automáticamente. Su `status` es
`MATCHED` (diferencia 0) o `DISCREPANCY` (no coincide); un tercer
estado, `INVALIDATED`, lo aplica el sistema después (§109.1.3), nunca
la persona que concilia.

Campos exactos (§80): casa, fecha/hora, saldo disponible LetFer, saldo
disponible oficial declarado, comprometido en LetFer (diagnóstico),
diferencia, usuario conciliador, estado.

#### 109.1.1 Quién y cómo (D-C2, D-C3, D-C4, D-C7)

- Un único paso: quien concilia declara el saldo oficial y LetFer
  compara de inmediato. No hay propuesta/aprobación en dos pasos.
- Solo Administrador de Proyecto y Administrador Global (§80); ningún
  otro rol, salvo permiso explícito futuro.
- Es por casa, independiente de la etapa: la banca es continua entre
  etapas (§11).
- El "saldo disponible LetFer" es exactamente `available` (balance menos
  comprometido) tal como ya lo calcula `computeHouseBalances` (D3): el
  comprometido no se sustrae dos veces, solo se muestra aparte como
  dato diagnóstico (§80), no participa en la comparación.
- No exige reautenticación: compara y registra, no mueve dinero ni
  genera movimientos.

#### 109.1.2 Resolución de una discrepancia (D-C5)

No existe un estado "RESUELTO". La resolución es: corregir el dato real
mediante las operaciones ya existentes (editar, liquidar, completar un
movimiento faltante) y volver a conciliar; si coincide, se crea un
checkpoint `MATCHED` nuevo. Un único modelo, sin un estado redundante.

#### 109.1.3 Invalidación de checkpoints (§74)

Una acción sobre una apuesta con efecto financiero potencial —editar,
liquidar, mover de etapa, eliminar lógicamente o restaurar— invalida
todo checkpoint `MATCHED` de la casa de esa apuesta cuyo `occurred_at`
sea posterior o igual a la fecha de colocación (`placed_at`) de la
apuesta afectada: el checkpoint asumía una fotografía que esa apuesta
ya integraba, y esa fotografía cambió. Una apuesta colocada **después**
del checkpoint nunca lo invalida (es actividad nueva, no una
corrección retroactiva). Invalidar registra cuándo y por qué
(`invalidated_at`, `invalidated_reason`), nunca borra ni reescribe el
checkpoint original (D2).

"Requiere nueva conciliación" (§74) se deriva en vivo: una casa lo
"requiere" cuando su checkpoint `MATCHED` no invalidado más reciente ya
no existe o quedó invalidado. Es puramente informativo (D-C6): no
bloquea apuestas, depósitos, retiros ni ninguna otra operación.

#### 109.1.4 Revisar desde última conciliación (§32.2)

Vista de solo lectura: apuestas y movimientos de la casa posteriores al
último checkpoint `MATCHED` no invalidado (o desde el origen, si nunca
hubo uno). Reduce la búsqueda de errores sin alterar nada.

### 109.2 Verificación de integridad del ledger (D-I1 a D-I3, precisa §38)

Herramienta de **solo lectura**: nunca corrige datos, nunca crea
movimientos, nunca inventa dinero (§38). Cada ejecución queda
registrada (quién, cuándo, resultado, hallazgos) para consulta
posterior.

Comprobaciones de la versión inicial (D-I1):

a. Cada casa, recalculada desde cero, no tiene disponible negativo.\
b. Los estados de apuesta y sus liquidaciones son coherentes: `LOST`
sin fila `BET_SETTLEMENT`; `WON`/`VOID`/`CASHOUT` con exactamente una
(D-B2).\
c. Ninguna apuesta `PENDING` referencia una etapa o casa en papelera.\
d. Los movimientos del ledger referencian proyecto, etapa y casa
existentes y consistentes con las restricciones del esquema (defensa
en profundidad de lo que los `CHECK` ya deberían garantizar).\
e. Todo checkpoint que debería estar `INVALIDATED` según el §109.1.3
efectivamente lo está.

Se ejecuta **manualmente, bajo demanda** (D-I2): esta etapa no
introduce tareas programadas para esto. Dos alcances (D-I3): por
proyecto (Administrador de Proyecto) y global, sobre todos los
proyectos (Administrador Global).

### 109.3 Backups automáticos (D-B1 a D-B4, precisa §37 y §82)

El backup se dispara desde dentro del propio proceso de la API (una
tarea programada interna), no desde un cron del sistema operativo ni un
proveedor concreto (D-B1): funciona igual sin importar dónde se aloje
el piloto real, todavía no decidido. El directorio de destino se
configura por variable de entorno.

Cada backup es una copia completa de PostgreSQL mediante `pg_dump` en
formato personalizado (restaurable con `pg_restore`), nunca parcial
(D-B2): debe poder reconstruir LetFer entero. El entorno de ejecución
(desarrollo y producción) debe tener `pg_dump`/`pg_restore` disponibles
en el `PATH`; no se empaqueta ni se sustituye ese requisito en esta
etapa.

El **manifiesto** de generaciones (fecha, tamaño, checksum, estado)
vive en un archivo junto a los propios volcados, fuera de PostgreSQL
(D-B3): si la base de datos se pierde, la lista de sus propios backups
no debe perderse con ella. La API solo lee ese archivo para mostrarlo;
no lo posee.

Retención aproximada de 30 generaciones diarias rotativas (D-B4, §37).

### 109.4 Recuperación ante fallos (D-R1, precisa §37)

La restauración es una operación de mantenimiento controlada, nunca en
caliente con la API sirviendo tráfico con normalidad (D-R1). Sigue el
orden del §37: backup preventivo del estado actual, reautenticación,
confirmación fuerte (escribir el identificador exacto de la generación
a restaurar), restauración, auditoría. Solo el Administrador Global
puede restaurarla (§37).

### 109.5 Permisos nuevos

De proyecto: `reconciliations.view` (todo rol de proyecto, igual que
`bets.view`), `reconciliations.confirm`, `integrity.view` e
`integrity.run` (Administrador de Proyecto). Globales, nuevo prefijo
`system.*` para capacidades de administración de toda la instancia (no
existía antes de esta etapa): `system.integrity.run` y
`system.backups.view` / `system.backups.create` /
`system.backups.restore`, reservados al Administrador Global.

## 110. Tickets e IA (Fase 7)

**Estado:** Aprobada.\
Precisa y completa los §28 a §31, §36, §37, §41, §42, §44, §51 a §53,
§90 y §97 con las decisiones de la Fase 7 (D-T1 a D-T6, ADR 0017). Si
alguna regla anterior las contradice, prevalece este apartado. Fuera de
alcance: eliminación independiente de tickets, object storage real
(S3/R2/MinIO) y cualquier autoridad automática de la IA sobre `betType`
o los datos financieros.

### 110.1 Proveedor de IA y almacenamiento (D-T1, D-T2)

Anthropic es el proveedor inicial de lectura de tickets, detrás de una
interfaz `TicketReader` (§52) que no debe filtrarse al resto del
sistema: `TicketsController`, `BetsService` y la web no conocen el
proveedor concreto. El almacenamiento de archivos es sistema de
archivos local inicialmente, detrás de una interfaz `FileStorage`,
preparada para migrar a un object storage real sin rediseñar el resto.
Los tickets nunca tienen URL pública; todo acceso es autenticado y
verifica pertenencia al proyecto (§42).

Los tickets se incorporan al sistema de backups de la Fase 5.5 (§109.3,
§109.4) en esta misma fase, no después: una generación de backup
`COMPLETED` debe poder reconstruir LetFer entero, archivos incluidos
(§37). No se acepta un backup que cubra la base de datos pero deje
fuera los archivos.

### 110.2 Validación de archivos (D-T3)

JPG/JPEG/PNG/PDF (PDF multipágina permitido); máximo 10 MB por
archivo. Se valida extensión, tipo MIME real del contenido (no el
`Content-Type` declarado por el cliente) y tamaño, antes de aceptar el
archivo y antes de enviarlo a la IA (§97).

### 110.3 Flujo de análisis (D-T4, D-T5, D-T6, precisa §29 a §31)

El análisis por IA es una acción explícita del usuario ("Analizar con
IA"), nunca automático al subir un archivo. El resultado es una
propuesta (`TicketAnalysis`, contrato §53) devuelta al formulario, con
confianza por campo cuando el proveedor la entrega: campos de alta
confianza se muestran con normalidad, los de baja confianza se
resaltan para dirigir la revisión humana. La confianza nunca decide
nada automáticamente (§30).

Cuando el ticket pertenece a una apuesta ya registrada, la comparación
es **campo por campo**: actualizar, mantener o editar manualmente cada
campo por separado, nunca aceptar o rechazar la propuesta completa como
única opción (§31).

La IA nunca escribe en `bets`. La confirmación humana reutiliza
`POST .../bets` y `PATCH .../bets/:id` ya existentes (§51: mismo flujo
financiero, no uno nuevo), con un `ticketId` opcional para vincular el
ticket dentro de la misma transacción.

### 110.4 Límite de análisis IA

Máximo 5 análisis por ticket y 50 por proyecto en una ventana móvil de
24 horas (valores configurables), para acotar el costo sin bloquear el
uso normal. Un intento fallido cuenta igual que uno exitoso para el
límite. Al superarse, la API responde con el código de límite de tasa
ya existente.

### 110.5 Tablas nuevas

`tickets` (archivo, apuesta asociada —nula hasta vincularse—, quién lo
subió, metadatos) y `ticket_analyses` (histórico de análisis,
**solo inserción**, mismo espíritu de inmutabilidad que
`reconciliation_checkpoints`/`integrity_check_runs`, D2/§109.1).

### 110.6 Permisos nuevos

De proyecto: `tickets.view` (todo rol, igual que `bets.view`),
`tickets.upload` y `tickets.analyze` (Administrador de Proyecto y
Colaborador, igual que `bets.create`). Sin permiso de eliminación en
esta fase.

## 111. Administración (Fase 8)

**Estado:** Aprobada.\
Precisa y completa los §4.1, §6, §8, §9, §10, §35, §36, §38, §87, §89 y
§104.10 con las decisiones de la Fase 8 (D8-1 a D8-10, ADR 0018). Si
alguna regla anterior las contradice, prevalece este apartado. Fuera de
alcance: purga física de datos de negocio o de auditoría, avatar,
creación de Administradores Globales, roles personalizados y su
interfaz, exportación de la auditoría y reconstrucción de balances.

### 111.1 Auditoría (D8-1, D8-2)

La auditoría se consulta por proyecto (Administrador de Proyecto, permiso
`audit.view`, solo su proyecto) y de forma global (Administrador Global,
`system.audit.view`). Colaborador y Lector no acceden. Es de solo
lectura, admite filtros (fechas, actor, acción, entidad) y paginación por
cursor, y no expone valores que la política de redacción oculta.
`audit_logs` no se purga en esta fase: debe poder explicar la historia
del sistema (§89, §103).

### 111.2 Papelera (D8-3)

Cada proyecto muestra su papelera de apuestas y etapas a quien puede
restaurarlas (`bets.restore`, `stages.restore`); el Administrador Global
y los propietarios ven la papelera de proyectos. Cada elemento indica
quién lo eliminó, cuándo y desde cuándo es elegible para purga (§89). La
elegibilidad es informativa: no se ejecuta ninguna purga física en esta
fase y la decisión de purgar queda pendiente de una política explícita.

### 111.3 Usuarios y eliminación de cuenta (D8-5, D8-6)

El Administrador Global lista y consulta usuarios, y puede deshabilitar y
reactivar cuentas (reautenticación reciente). La eliminación de cuenta
(§8) es una solicitud del usuario (`account_deletion_requests`, con los
estados `PENDING`, `APPROVED`, `REJECTED` y `CANCELLED`, una sola
pendiente por usuario) que solo el Administrador Global aprueba o
rechaza; aprobar exige reautenticación y deja la cuenta eliminada
lógicamente (§104.6), sin borrado físico. Un usuario propietario de algún
proyecto no puede ser deshabilitado ni eliminado hasta transferir la
propiedad de todos sus proyectos (§87).

### 111.4 Protección del último Administrador Global (D8-10)

El sistema no puede quedarse sin un Administrador Global activo. Se
impide deshabilitar o eliminar lógicamente al último, tanto desde la API
como directamente en la base de datos, incluso ante operaciones
simultáneas. Todo intento bloqueado queda auditado.

### 111.5 Administración de proyectos y sesiones

El Administrador Global ve todos los proyectos y transfiere su
propiedad (§6, §87) desde la interfaz. Cada usuario ve y cierra sus
sesiones abiertas; el Administrador Global puede cerrar las de un
usuario (§104.7).

### 111.6 Mantenimiento (D8-4)

Una tarea diaria interna, ejecutable también bajo demanda por el
Administrador Global, elimina únicamente registros auxiliares caducados
(sesiones expiradas o revocadas, intentos de acceso y tokens de
recuperación vencidos o usados) con más de 30 días de antigüedad
(configurable). Nunca toca datos de negocio, ledger, invitaciones ni
auditoría. Cada ejecución queda registrada y auditada. "Recalcular
balances" (§38) no requiere una herramienta aparte: los saldos se
calculan siempre desde el ledger y su coherencia se comprueba con la
verificación de integridad (§109.2).

### 111.7 Permisos nuevos

De proyecto: `audit.view` (Administrador de Proyecto). Globales, reservados
al Administrador Global: `system.audit.view`, `system.users.view`,
`system.users.manage`, `system.account_deletions.decide` y
`system.maintenance.run`.
