# 0025. Reportes e informes PDF

- **Estado:** Propuesta (implementada en desarrollo, pendiente de aprobación para publicar)
- **Fecha:** 2026-10-15
- **Referencias:** especificación §108.11, §108.8, §112.6; ADR 0015, 0023; referencias
  `docs/referencias/Referencias mockups/Reportes/` («Panel de reportes», «Vista de reportes en PDF»)

## Contexto

Reportes solo mostraba el análisis filtrado y la curva de rendimiento. Se necesita generar un
informe PDF con el resumen del periodo y TODAS las apuestas incluidas, con el mismo alcance que el
panel, sin capturas de pantalla y sin cálculos financieros nuevos.

## Decisión

- **Generación en el backend con `pdfkit` 0.20.2** (+ `@types/pdfkit` 0.17.6 en desarrollo). Es
  JavaScript puro (sin binarios nativos ni navegador), funciona en Windows y en producción, usa las
  fuentes estándar Helvetica (sin archivos ni licencias de fuentes; WinAnsi cubre á, é, ñ, ¿, S/) y
  deja el texto seleccionable. Es la única dependencia nueva: LetFer no tenía capacidad de PDF.
- **Datos:** `ReportsService` reutiliza `DashboardService.analysis` (métricas) y una consulta nueva
  de solo lectura, `DashboardService.reportRows`, que devuelve las filas de la MISMA CTE del análisis
  con su monto apostado y su ganancia según el ledger. Así la tabla suma lo mismo que el resumen.
  `BetsService.reportDetails` añade resúmenes y selecciones en tres consultas (sin N+1).
- **Rutas:** `GET /projects/:id/reports/data` (JSON para el panel) y `GET /projects/:id/reports/pdf`
  (descarga `application/pdf`, `Content-Disposition: attachment`, `Cache-Control: private, no-store`),
  con `@ProjectRoute('bets.view')` + `houses.view` + `movements.view` (§108.8): un ajeno recibe 404.
  El PDF se genera en memoria al pedirlo; no se guarda ni tiene URL pública.
- **Filtro nuevo, aditivo:** `origin` (`MANUAL` / `IMPORTED`) en los filtros del análisis.
- **Orden compartido:** `sortReportBets` (`@letfer/shared`) ordena igual el panel y el PDF.
- **Plantilla (`report-pdf.ts`):** función pura `ReportData → Buffer` con portada (identificación,
  filtros, resumen), análisis (rendimiento acumulado, distribución por resultado, montos por casa,
  resumen por tipo), detalle paginado (cabecera repetida, filas que no se parten, nombres en varias
  líneas, legs con su cuota una vez), totales, anexo opcional de tickets y pie «Página X de Y».

## Consecuencias

- **Despliegue:** cambia `package-lock.json`; el script de despliegue actual se niega a desplegar
  con cambios de dependencias. Publicar esta versión requiere un script que ejecute `npm ci` en el
  clon de producción (o copie `node_modules` ya verificados).
- Un reporte de más de 5 000 apuestas responde 413 y pide acotar el periodo.
- Los tickets en PDF no se incrustan (se indica en el anexo); solo JPEG/PNG, hasta 60 imágenes.
