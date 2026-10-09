# Sistema de diseño de LetFer

Referencia viva del lenguaje visual de la web (Fase 11, rediseño UX/UI). Documenta lo que ya
existe en `apps/web/src/ui.tsx` y los patrones que lo acompañan, para que una pantalla nueva se
construya reutilizando esto en vez de inventar un estilo propio. Si algo de este documento deja
de coincidir con el código, manda el código: actualiza este documento, no al revés.

## 1. Principio

> Claridad > decoración. Jerarquía > cantidad. Datos > chrome. Confianza > efectos.

LetFer es una herramienta financiera, no un casino ni una plantilla de panel genérico: el violeta
de marca se reserva para "esto es lo que puedes hacer ahora" (acción principal, selección, foco),
nunca como relleno decorativo. Una pantalla no debe sentirse terminada por tener bordes y sombras
en todo — debe sentirse terminada cuando el dato importante domina y el resto no compite con él.

## 2. Tokens de color (`apps/web/src/index.css`)

Un único archivo de tokens, nunca clases `dark:` sueltas por el proyecto. El tema oscuro no es
"el claro invertido": redefine las mismas variables con su propia paleta (navy, no negro puro),
así que un componente escrito una vez con `bg-slate-100`/`text-slate-900`/etc. se ve bien en
ambos temas sin tocarlo.

| Token | Uso |
|---|---|
| `--color-surface` | Tarjetas, paneles, campos |
| `--color-surface-2` | Panel anidado dentro de una tarjeta (un paso más "hundido") |
| `--color-sidebar*` | Barra lateral, siempre oscura en los dos temas (identidad persistente) |
| `slate-50…950` | Fondo de página, bordes, texto secundario/principal — redefinidos completos en `[data-theme='dark']` |
| `violet` | Marca, acción primaria, selección, foco — nunca decoración |
| `green` / `red` | Positivo / negativo (ganancia, pérdida) |
| `amber` / `orange` | Advertencia, comprometido, pendiente de confirmar |
| `blue` | Informativo, disponible |

Los estados de una apuesta (`bet-status-style.ts`) y los colores de gráficos (`chart-theme.ts`)
fijan sus propios 600 (iguales en ambos temas, como los botones) para Ganada/Perdida/Cash Out,
pero dejan Pendiente/Anulada en variables del tema — un gris fijo se volvía casi invisible en
fondo navy.

**Regla crítica (§6 del encargo, ya cumplida en todo el código):** ningún estado se distingue solo
por color. Siempre icono + texto + color (`BetStatusBadge`, `betStatusIcon`).

## 3. Tipografía (`ui.tsx`)

Escala con un propósito cada una, para que un dato financiero nunca compita con una descripción:

| Export | Uso |
|---|---|
| `displayValueClass` | La cifra protagonista de una pantalla (capital del dashboard) |
| `metricValueClass` | Cifra importante pero no protagonista |
| `fieldLabelClass` | Rótulo discreto encima de un dato |
| `captionClass` | Texto de apoyo, el más pequeño |

`PageHeader` dedica `text-2xl font-semibold` al título y relega la descripción a una frase corta
(`text-sm text-slate-500`); si hace falta explicar más, va en `help` (`HelpTip`), nunca en un
párrafo permanente bajo el título.

## 4. Componentes base (`ui.tsx`) — uno solo por concepto

| Componente | Reemplaza/unifica |
|---|---|
| `Section` | Único primitivo de tarjeta con título (antes existían `Section` **y** `DashboardCard`, casi idénticos; `dashboard/DashboardCard.tsx` ahora solo re-exporta `Section`) |
| `PageHeader` | Título + descripción corta + `help` opcional (`HelpTip`) + acciones |
| `SubNav` | Navegación interna de una pantalla larga (anclas `href="#id"`, p. ej. Finanzas) |
| `Modal` | Panel flotante; `widthClassName` adaptable al contenido (ver §6) |
| `Lightbox` | Visor de imagen a pantalla casi completa (tickets) |
| `Notice` | Aviso en línea (`error`/`success`/`warning`/`info`), con `action` opcional |
| `Badge` | Etiqueta de estado (proyecto, invitación…) |
| `HelpTip` / `Help` (glosario) | "[?]" contextual; posicionamiento consciente del viewport |
| `SegmentedControl` | Selector de opción única en una fila (periodo, tipo de movimiento…) |
| `EmptyState` / `LoadingBlock` / `Skeleton` | Estados vacíos y de carga, nunca "0" provisional ni "No hay datos" sin acción |
| `btn` / `btnPrimary` / `btnDanger` / `btnGhost` / `btnIcon` | Jerarquía de botones — una sola acción primaria por bloque |

**Antes de crear un componente nuevo, busca si ya existe uno equivalente aquí.**

## 5. Navegación (`AppShell.tsx`, `ProjectLayout.tsx`)

- Barra lateral **siempre oscura**, agrupada por modelo mental: Apuestas (Apuestas, Retornos,
  Reportes) · Dinero (Casas y Finanzas, Etapas, Importaciones) · Proyecto (Miembros, Eliminados,
  Auditoría, Configuración), filtrada por permiso.
- "Proyectos eliminados" (global, `ArchiveIcon`) vs. "Eliminados" (dentro de un proyecto,
  `TrashIcon`): conceptos distintos, nombres e iconos distintos a propósito (antes ambos se
  llamaban parecido con el mismo icono).
- Cambio de tema en la **barra superior**, siempre visible (antes solo al pie de la barra lateral,
  oculto en móvil sin abrir el cajón).
- Enlace "Saltar al contenido" (skip link), visible solo al enfocar con teclado.

## 6. Patrones de formulario

- **Añadir apuesta** (`NewBetForm.tsx`) es el formulario de referencia: sin selector de etapa (es
  contexto del backend, no un campo), presets de stake 10/20/30/40/50 + "Otra cantidad", resumen
  financiero con cifras calculadas en vivo, nunca inventadas.
- El `<Modal>` que lo envuelve tiene **ancho adaptable al formato** (`NewBetForm` avisa el formato
  elegido vía `onFormatChange`; quien monta el `Modal` decide `widthClassName`): compacto para
  Simple, más ancho para Múltiple/Creada, cuyas selecciones se reparten en una grilla de 2
  columnas que escala bien hasta 8-10 selecciones sin sentirse como "10 formularios pegados".
- Secciones de un formulario largo usan `FormStep` (`BetSettlementFields.tsx`): número, pregunta,
  ayuda breve — nunca una pared de inputs sin agrupar.

## 7. Flujo de IA / tickets

`TicketPanel.tsx` + `ticket-prefill.ts`: Ticket → "Leer ticket con IA" → extracción → prellenado
**completo** del formulario (nunca "usar este valor" campo por campo en el alta) → revisión humana
→ registro manual. La IA nunca escribe en `bets`. Si el formulario ya se tocó a mano, una nueva
lectura pregunta "Reemplazar con esta lectura" / "Mantener mis cambios" — nunca sobrescribe en
silencio. Ver el ticket abre un `Lightbox` interno (nunca una pestaña nueva del navegador).

Cuando el análisis falla, `TicketPanel` muestra el motivo real que ya redacta la API
(`"No pudimos leer el ticket…"`), no el genérico de servidor — una corrección deliberadamente
acotada a este punto de llamada, no un cambio del mapeo general de errores (`describeApiError`
trata `INTERNAL_ERROR` como "no confiable" a propósito en otros puntos de la API, como los
backups; cambiarlo ahí habría sido tocar más de lo necesario).

## 8. Responsive

- Mobile-first en los primitivos: `Modal` a pantalla completa en móvil, tablas con
  `overflow-x-auto` en su propia tarjeta, grillas que colapsan (`sm:`/`md:`/`lg:`/`xl:`).
  `RecentBets` del Dashboard reduce columnas progresivamente (Cuota solo desde `xl:`; Stake y A+G
  quedan solo en "Apuestas", la lista completa).
- **Limitación conocida de esta ronda:** la verificación visual en vivo de esta fase se hizo en
  escritorio (1528px) y, por código, se revisaron las clases responsive de cada pantalla; el
  entorno de automatización de navegador disponible no permitió redimensionar la ventana para
  confirmar visualmente 375/768/1024/1440px en esta sesión. Queda pendiente una pasada visual
  móvil real.

## 9. Accesibilidad

`focus-visible` consistente, `aria-live`/`aria-busy`/`role=status|alert`/`sr-only` en estados de
carga y avisos, navegación por teclado completa en `DropdownMenu` (flechas, Home/End, Escape),
`HelpTip` y `DropdownMenu` miden su posición y se recolocan si se saldrían del viewport,
`prefers-reduced-motion` respetado globalmente (`index.css`) y en las animaciones puntuales
(`motion-safe:active:scale-[0.98]` de los botones).
