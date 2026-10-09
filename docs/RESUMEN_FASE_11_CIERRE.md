# Cierre de la Fase 11 — Rediseño UX/UI

**Estado:** implementación y validación completas sobre `fase-9.1/modelo-importacion`, sin
integrar a `main`. Solo UI/UX: ninguna regla financiera, de permisos o de IA cambió de
comportamiento.

## Qué se rediseñó

El trabajo se hizo en dos rondas sobre el mismo Design System (ver `docs/SISTEMA_DISENO.md` para
el estado final, vivo):

**Ronda 1 — brechas de la auditoría previa:**
- Unificación de `Section`/`DashboardCard` en un único primitivo de tarjeta.
- AppShell: tema visual movido a la barra superior (antes solo al pie de la barra lateral);
  enlace "Saltar al contenido".
- Dashboard: Yield/ROI como contexto del capital (sin repetir la cifra), densidad reducida de
  "Apuestas recientes", agrupación conceptual (Rendimiento / Apuestas / Actividad / Accesos).
- Añadir apuesta: ancho del `<Modal>` adaptable al formato (Simple compacto, Múltiple/Creada más
  ancho con selecciones en grilla de 2 columnas), contexto de etapa activa evaluado y luego
  **retirado** (ver más abajo).
- Ticket: visor `Lightbox` interno en vez de pestaña nueva del navegador.
- Finanzas: navegación interna (`SubNav`) entre Casas / Movimientos / Retiros / Conciliación /
  Historial, con anclas reales filtradas por permiso.
- Descripciones largas de cabecera (Retornos, Reportes, Finanzas, Etapas, Configuración) movidas a
  `HelpTip` (`PageHeader` ahora acepta `help`).
- `HelpTip` y `DropdownMenu`: posicionamiento consciente del viewport (ya no se recortan cerca de
  un borde).

**Ronda 2 — rediseño maestro (este cierre):**
- "Proyectos eliminados" (papelera global de proyectos) vs. "Eliminados" (papelera de apuestas y
  etapas dentro de un proyecto): nombres e iconografía distintos a propósito (antes ambos decían
  "Papelera"/"Eliminados" sin que quedara claro que eran conceptos distintos).
- Verificación en vivo de que la grilla de 2 columnas de selecciones escala sin romperse hasta 8
  selecciones (Múltiple).
- **Corrección sobre la Ronda 1:** un encargo posterior pidió explícitamente que "Añadir apuesta"
  no mostrara NINGÚN contexto de etapa (ni nombre ni unidad) — se retiró el bloque que la Ronda 1
  había añadido. El cálculo interno (stake × unidad de la etapa activa) nunca cambió.
- Corrección de un bug real de manejo de errores encontrado durante el diagnóstico de IA: un
  fallo al leer un ticket con IA mostraba el genérico de servidor en vez del motivo real y seguro
  que ya redacta la API — corregido en el único punto de llamada afectado (`TicketPanel.tsx`), sin
  tocar el mapeo general de errores (`describeApiError` trata `INTERNAL_ERROR` como "no confiable"
  a propósito en otros puntos, como los backups).
- Validación visual real en navegador (Chrome, vía la extensión de automatización), contra datos
  reales de `letfer_trial`: Dashboard, Apuestas, Añadir apuesta (Simple y Múltiple con 8
  selecciones), Finanzas (navegación interna en uso), Reportes — en tema oscuro y claro. Sin
  defectos visuales encontrados (ver "QA visual" abajo).

## QA visual (lo que se recorrió de verdad, no solo lectura de código)

Entorno: `npm run dev` contra `letfer_trial` (datos reales de ensayo), Chrome vía
`claude-in-chrome`.

| Pantalla | Resultado |
|---|---|
| Dashboard (oscuro) | Jerarquía correcta: capital protagonista, Yield/ROI de contexto, grupos Rendimiento/Apuestas/Actividad/Accesos legibles, sin pared de tarjetas |
| Añadir apuesta — Simple | Modal compacto, sin bloque de etapa, resumen financiero correcto |
| Añadir apuesta — Múltiple (8 selecciones) | Modal ancho, grilla de 2 columnas sin romperse, "Añadir evento"/stake/resultado todo accesible con scroll normal |
| Apuestas (claro) | Buena jerarquía Stake/Importe/Cuota/A+G/Ganancia, estados con icono+color, sin ticket deshabilitado correctamente |
| Casas y Finanzas | `SubNav` funcional: clic en "Retiros" salta a la sección, sticky, nada queda tapado |
| Reportes | Filtros alineados, métricas con jerarquía clara, desglose por casa/etapa/deporte/mercado/periodo legible |

**Hallazgo no-bug:** "Por deporte" muestra "Futbol" y "Fútbol" como filas separadas — es un dato
de prueba con dos grafías distintas (el deporte es texto libre en el modelo, por diseño), no un
defecto de la interfaz. No se tocó.

**Limitación de esta ronda:** el redimensionado de ventana de la herramienta de automatización no
tomó efecto en este entorno (falló tras varios intentos) — no se pudo verificar visualmente 375 /
768 / 1024 / 1440px en vivo. La confianza en móvil viene de la auditoría de clases responsive del
código (`sm:`/`md:`/`lg:`/`xl:`, `overflow-x-auto`, `Modal` a pantalla completa), no de una captura
real. Recomendado como siguiente paso si se quiere cerrar del todo el criterio de "cada breakpoint
diseñado, no comprimido" (§44 del encargo).

## Decisiones de UX que conviene revisar

1. **Etapa en "Añadir apuesta":** dos encargos consecutivos pidieron lo contrario (mostrarla
   discretamente, luego no mostrarla en absoluto). Quedó **sin mostrarla**, la versión más
   reciente. Si en algún momento hace falta que la persona vea la unidad sin ir a "Etapas", avisar
   explícitamente — no se va a reintroducir por iniciativa propia.
2. **Tablas largas** (historial de movimientos, auditoría): no recibieron una pasada dedicada de
   "sticky header"/densidad configurable (§26 del encargo); hoy usan el patrón ya existente
   (`overflow-x-auto` dentro de su tarjeta), que la QA visual no encontró roto, pero no es la
   versión más ambiciosa que pedía el encargo.
3. **Microinteracciones:** se añadió `active:scale` en botones (respeta `prefers-reduced-motion`);
   no se auditó cada transición de aparición/salida de contenido una por una.

## Validación técnica

`npm run check` (format, lint, typecheck, pruebas de `shared`/`api`/`web`, build) en verde antes
de este cierre. Ninguna prueba se eliminó; las afectadas por cambios de texto/estructura visual se
actualizaron (nunca una prueba financiera).

## Git

Rama `fase-9.1/modelo-importacion`. Sin commit, push ni merge — pendiente de tu revisión y
confirmación explícita antes de integrar.
