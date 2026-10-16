# 0026. Informe ejecutivo PDF 2.0

- **Estado:** Propuesta (implementada en desarrollo, pendiente de aprobación para publicar)
- **Fecha:** 2026-10-16
- **Referencias:** especificación §108.11; ADR 0025 (lo amplía); referencia
  `docs/referencias/Referencias mockups/Reportes/Reporte ejecutivo.png`

## Contexto

El PDF de la ADR 0025 era correcto pero se leía como un listado: portada con métricas, un análisis
breve y la tabla. Se pidió un **informe ejecutivo** con lectura narrativa en cinco bloques, siguiendo
la referencia «Reporte ejecutivo», sin cambiar fórmulas financieras, sin texto generado por IA y sin
cifras que no salgan de los datos.

## Decisión

- **Cinco bloques**, cada uno ligado a una sección del constructor (que se conserva):
  `summary` → 1. Reporte ejecutivo de rendimiento; `charts` + `metrics` → 2. Análisis financiero y
  estadístico; `segments` (nueva) → 3. Análisis por segmentos; `operations` (nueva) → 4. Control
  operativo / Gestión del negocio; `table` (+ `selections`) → 5. Detalle de apuestas; `tickets` →
  anexo. `DEFAULT_REPORT_SECTIONS` = `EXECUTIVE_REPORT_SECTIONS` = las siete primeras; el panel añade
  el atajo «Reporte ejecutivo completo». Sin endpoints nuevos.
- **Renderer modular** en `apps/api/src/reports/pdf/` (`theme`, `format`, `frame`, `icons`, `charts`,
  `insights`, `cover`, `analysis`, `segments`, `operations`, `detail`, `tickets`); la entrada sigue
  siendo `renderReportPdf`. Solo presenta: **ROI y Yield se muestran tal como llegan de la API, con dos
  decimales y signo** (`+16.48 %`), igual en el panel (`formatRate`) y en el PDF; los demás porcentajes
  descriptivos (win rate, participaciones) usan un decimal redondeando la cadena (sin coma flotante).
- **Datos nuevos (aditivos) en `ReportData`**, calculados en `ReportsService` con utilidades
  decimales compartidas: `totals.settledBets`, `totals.averageStakeSettled` (`averageMoney`,
  ROUND_HALF_UP), `byBetType[].settledBets/totalStaked/profitLoss` y `highlights.best/worst` (mayor
  ganancia y mayor pérdida según el ledger).
- **Segmentos con Yield, no ROI:** el ROI de LetFer usa el capital invertido del proyecto, que no se
  reparte por casa, tipo ni deporte. Las tablas muestran Yield (ganancia ÷ monto apostado, el mismo
  del análisis) y la fila Total es la del análisis. Más de 8 filas → las de mayor monto y «Otros (n)»
  (sumas con `sumMoney`, Yield con `percentageOf`). Una apuesta con varios deportes cuenta en «Mixto».
- **Observaciones deterministas** (`pdf/insights.ts`): conclusión («Periodo rentable», «Periodo con
  pérdidas», «Resultado equilibrado», «Resultado no determinado»), «Lectura rápida» (resultado,
  actividad, exposición o win rate) y «Riesgos y observaciones» con umbrales fijos: casa ≥ 50 % del
  monto (o una sola casa), deporte ≥ 60 %, comprometido en pendientes, mayor ganancia/pérdida ≥ 50 %
  del neto (con ≥ 3 liquidadas), perdidas ≥ 60 % de las decididas (con ≥ 10), muestra < 10 liquidadas
  y retornos provisionales. Nunca recomiendan, predicen ni califican; el bloque aclara que describe
  el periodo.
- **Tipografía:** Inter (`@fontsource/inter` 5.3.0, licencia SIL OFL 1.1) leída del paquete
  instalado e incrustada como subconjunto (texto seleccionable y buscable, sin descargas al
  generar). Las pruebas usan `fonts: 'standard'` (Helvetica) para poder inspeccionar el texto.
- **Paginación:** el marco quita los márgenes automáticos de pdfkit (nunca abre páginas por su
  cuenta), repite la cabecera de la tabla, rotula cada página «Detalle de apuestas (X – Y de N)» y
  escribe «Pág. X de Y» al final. Una Múltiple que no cabe se parte entre legs con
  «N.º n (continuación)»; nunca se trunca la lista.

## Consecuencias

- **Despliegue:** nueva dependencia de producción (`@fontsource/inter`): cambia `package-lock.json`
  y exige `npm ci` en el clon de producción (el script de despliegue de 4d7d223 ya lo hace).
- Las fuentes se incrustan como subconjunto: un informe sintético de 100 apuestas pesa ≈ 100 KB
  (el anterior, con Helvetica, ≈ 370 KB) y uno de 500 en apaisado ≈ 220 KB.
- Aprobado por el usuario (2026-10-16): Yield por segmento; el ROI se mantiene como indicador global
  y el PDF explica ambos denominadores (monto apostado de las liquidadas y capital invertido).
