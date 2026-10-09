# Guía de prueba manual: Fase 10.3 (flujo financiero)

Pasos para preparar y recorrer, **desde la interfaz**, el flujo financiero sobre la base de ensayo
`letfer_trial`. Todo lo que no salga como se espera se anota en `docs/HALLAZGOS_FASE_10.md`
(sección "Escenarios de la 10.3"). No se cargan datos por código: los datos los introduce la persona
que prueba. Entorno y detalles técnicos en `docs/GUIA_ENTORNO_ENSAYO.md`.

## 0. Arrancar el entorno

En una ventana de PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File C:\LetFerEnsayo\iniciar-ensayo.ps1
```

El script usa solo la base `letfer_trial` y las carpetas de `C:\LetFerEnsayo`. Arranca PostgreSQL,
aplica las migraciones pendientes y levanta la API y la web. Abre <http://localhost:5173>. Para
detenerlo, pulsa `Ctrl+C` en esa ventana.

## 1. Crear el Administrador Global (una sola vez)

En **otra** ventana de PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File C:\LetFerEnsayo\crear-admin.ps1
```

El script pide correo, nombre, apellido y contraseña. La contraseña no se muestra al escribirla y
debe tener al menos 10 caracteres. Después, inicia sesión en la web con esa cuenta.

## 2. Crear el proyecto de ensayo

1. **Mis proyectos → "Nuevo proyecto".**
2. Nombre, por ejemplo, "Ensayo financiero"; zona horaria `America/Lima`.
3. Al entrar al proyecto aparece el aviso de configuración pendiente: **"Completar configuración"**.

## 3. Configuración inicial y casas

1. En **Configuración inicial**:
   - la unidad de stake de la Etapa 1 (p. ej. `10.00`);
   - las casas con su monto inicial (p. ej. Betsafe y Betano con los saldos que quieras usar como
     banca).
2. Comprueba en **Casas y Finanzas**:
   - que cada casa tiene su saldo;
   - que la banca inicial aparece en el historial de movimientos.
3. Prueba también:
   - **"Nueva casa"** (una tercera casa, con o sin saldo);
   - desactivar y reactivar una casa.

## 4. Etapas

En **Etapas → "Nueva etapa"**: crea una segunda etapa con otra unidad.

- Solo una etapa puede estar activa.
- Cerrar una etapa no reinicia la banca.
- Corregir la unidad de una etapa pide la contraseña.

## 5. Miembros con roles

En **Miembros → "Nueva invitación"**: elige el **rol al ingresar**, el vencimiento y si es de un solo
uso, y genera el enlace. El enlace se muestra **una sola vez**: cópialo. Ábrelo en otra ventana
privada (o en otro navegador) y registra a la persona.

Crea al menos:

| Persona | Rol | Para qué |
|---|---|---|
| A | Administrador de Proyecto | Operar sin ser propietaria |
| B | Colaborador | Registrar apuestas propias; solo consulta finanzas |
| C | Lector | Solo lectura |
| D | Sin invitación a este proyecto | Comprobar que no ve nada del proyecto (10.4) |

Para D basta con otra invitación a un proyecto distinto, o crear su cuenta y no añadirla a este.

## 6. Recorrer los escenarios

Sigue la tabla "Escenarios de la 10.3" de `docs/HALLAZGOS_FASE_10.md`, en orden.

- **Antes de empezar**, y antes de cualquier escenario que pueda estropear datos: haz un **backup
  manual** (Administración → Sistema → sección "Backups"; solo lo ve el Administrador Global).
- **Después de cada escenario**, comprueba:
  - **Configuración → Verificación de integridad → "Verificar ahora"**, sin hallazgos;
  - que el **Dashboard** tiene sentido con lo registrado;
  - la **Auditoría** del proyecto.
- **Para conciliar**, ten a mano el saldo oficial de cada casa. Si el ensayo usa montos ficticios,
  usa como "oficial" el saldo que esperas por tus propios cálculos, fuera de LetFer.
- **Anota cada resultado** en la tabla: `OK`, o el ID del hallazgo (`H-nn`) si algo falla.

## 7. Repetición de F-05 y F-06 (tras las correcciones 10.3a–10.3g)

Antes de empezar: vuelve a arrancar el entorno (`C:\LetFerEnsayo\iniciar-ensayo.ps1`) para cargar
el código actual. No hay migraciones nuevas. Haz un backup manual.

Marca cada punto; si algo falla, anota un hallazgo nuevo en lugar de `OK`.

### F-05 — Etapas

1. **Etapas**: la explicación de qué es una etapa y la etapa activa resaltada, con su **unidad de
   stake** a la vista.
2. **Nueva etapa** con otra unidad (p. ej. S/ 20): la anterior queda cerrada y la nueva activa; la
   banca no se reinicia (Dashboard → Capital actual igual que antes).
3. **Corregir unidad** de una etapa: **Ver impacto** muestra unidad actual, nueva y apuestas
   afectadas; **Confirmar corrección** pide la contraseña y queda en Auditoría.
4. En **Añadir apuesta**, el paso 2 muestra cada etapa con su unidad, y el importe del paso 4 cambia
   al elegir otra etapa.

### F-06 — Apuestas (alta, edición, lista y liquidar)

**Alta (Apuestas → Añadir apuesta)**

1. **Fecha y hora**: vienen con el momento actual y se pueden cambiar. Debajo dice «Hora del
   proyecto (America/Lima)».
2. **Casa**: al elegirla se ve su **disponible**.
3. **Etapa**: la activa por defecto, con su unidad.
4. **Formato**: Simple, Múltiple (un partido por tarjeta y cuota total aparte) y Creada (varias
   selecciones del mismo partido).
5. **Partido** y **Pronóstico** en campos distintos; **Deporte** con Fútbol por defecto y «Otro…».
6. **Stake**: los botones 1 a 10 y un valor escrito (p. ej. 12.5); con texto no válido, el
   formulario no envía nada.
7. **Importe**: `stake × unidad` con el cálculo a la vista (p. ej. «3 × S/ 20.00»). Con un stake
   muy alto, aviso de que supera el disponible.
8. **Cuota**: editable; «Si gana» muestra lo que devolvería.
9. **Resultado** (si tienes permiso de liquidar): Pendiente por defecto. En Pendiente, A+G y
   Ganancia muestran «-».
10. **Ganada**: A+G = importe + ganancia, con la ganancia calculada. Al **ajustar la ganancia** la
    cuota visible no cambia y se muestra la cuota efectiva; «Usar la calculada» deshace el ajuste.
11. **Perdida**: A+G 0 y ganancia = −importe, sin campo editable.
12. **Anulada**: A+G = importe y ganancia fija en 0.00, sin campo editable. Escribe una ganancia en
    Ganada y cambia a Anulada: debe volver a 0.00.
13. **Cash out**: la ganancia es obligatoria.
14. Registra una de cada tipo (pendiente, ganada, ganada ajustada, perdida, anulada).

**Lista de apuestas**

15. Cada apuesta muestra partido, fecha y hora, casa, tipo, etapa, deporte, stake, importe, cuota,
    A+G y ganancia (con signo `+`/`-`).
16. A la vista: **Ver ticket** (o «Sin ticket»), el **Estado** con icono, **Editar** (lápiz) y
    **Eliminar** (papelera). En ⋮: mover de etapa, adjuntar ticket, historial, corregir o reabrir.
17. **Eliminar** una pendiente pide confirmación y explica que libera el importe reservado; queda en
    «Ver la papelera».
18. **Filtros** por estado y **buscador** (partido, casa o deporte).

**Editar**

19. **Editar** una pendiente: se abre con la **fecha y hora guardadas** (no las actuales); al cambiar
    el stake se recalcula el importe.
20. Una liquidada solo deja corregir el motivo.

**Liquidar** (sin entrar en F-07: solo comprueba el formulario)

21. Desde el selector **Estado** de una pendiente, elige Ganada: se abre «Liquidar» con la **fecha y
    hora actuales** y las mismas cifras que el alta.

**Zona horaria (H-20)**

22. Las fechas de la lista coinciden con la hora de Lima con la que registraste.
23. En **Reportes**, filtra «Desde» y «Hasta» con el día de hoy: aparecen las apuestas liquidadas
    hoy en hora de Lima, también las de la noche (después de las 19:00).

Después: verificación de integridad sin hallazgos, Dashboard coherente y Auditoría. Si todo está
bien, anota `OK` en F-05 y F-06.
