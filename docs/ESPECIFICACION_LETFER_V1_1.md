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

La eliminación definitiva está reservada al Administrador Global.

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
de la etapa.

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
-   Requieren aprobación.
-   Afectan la banca solo al aprobarse.
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

## 18. Apuestas

Cada apuesta pertenece obligatoriamente a:

-   Proyecto.
-   Etapa.
-   Casa.
-   Usuario creador.

Conserva, entre otros:

-   Fecha real de colocación.
-   Hora real si existe.
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

La clasificación se deriva de la estructura:

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

Estados fijos:

-   Pendiente.
-   Ganada.
-   Perdida.
-   Anulada/Cancelada.

En v1 no habrá resultado financiero individual por selección. El
resultado final del ticket afecta al dinero.

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
resúmenes afectados.

## 25. Movimiento entre etapas

Solo administradores autorizados.

Antes de mover se muestra etapa actual, destino, unidades e impacto.

Se recalculan valores derivados conforme a la etapa destino, respetando
los valores oficiales confirmados.

La fecha real de colocación no cambia.

## 26. Eliminación de apuestas

Eliminación lógica con papelera durante **90 días**.

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
analiza la estructura para proponer Simple, Creada o Múltiple.

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

El usuario introduce/confirma el saldo oficial real de la casa.

LetFer compara:

-   Saldo calculado LetFer.
-   Saldo oficial declarado.
-   Diferencia.
-   Última conciliación correcta.

### 32.1 Coincidencia

Si la diferencia es 0, se crea un **checkpoint de conciliación** con
fecha/hora, saldo LetFer, saldo oficial y diferencia 0.

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

Indicadores principales:

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

## 37. Backups

-   Backup automático diario.
-   Referencia MVP: aproximadamente 30 generaciones diarias rotativas.
-   Los archivos/tickets tendrán estrategia compatible de respaldo.
-   El backup debe permitir reconstruir LetFer, no solo algunas tablas.

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
│   └── ESPECIFICACION_LETFER_V1.md
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
-   `created_at`: cuándo se registró en LetFer.
-   `updated_at`: última modificación.

Esto permite importar historial sin falsear fechas.

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

PostgreSQL, usuarios y autenticación.

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

Auditoría, papelera y administración.

### Fase 9 --- Migración

Importación controlada del Excel histórico.

### Fase 10 --- Pruebas reales

Uso operativo, corrección de flujos y validación financiera.

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
