# ADR 0027: rendimiento de carga de la web

## Contexto

Medido en un QA aislado (Chrome real, red local, «cable» 10 Mbps y «móvil» 4G lenta con CPU ×4), la web
perdía tiempo en tres sitios: una cascada de cuatro esperas al abrir el Dashboard (sesión → proyecto →
código del Dashboard → datos), un paquete inicial con todas las pantallas (590 KB) y un logotipo de 105 KB
mostrado a 36–56 px. Caddy y la API respondían en menos de 30 ms: el servidor no era el cuello de botella.

## Decisiones

1. **Rutas bajo demanda.** Solo Login, la lista de proyectos, el shell y `ProjectLayout` van en el paquete
   inicial; el resto se carga con `React.lazy` (`route-loaders.ts`). Los trazados de Recharts del Dashboard
   (`CapitalPlot`, `DonutPlot`, `Sparkline`) también son diferidos: las cifras se pintan primero.
2. **Carga anticipada** (`api/early.ts`, `early-start.ts`). Al abrir `/projects/:id` se piden a la vez el
   proyecto y los datos del Dashboard, y se descarga su código. Reglas de seguridad, no negociables:
   - solo GET sin cuerpo; cada resultado se entrega **una sola vez**, a la **misma ruta exacta** (incluye el id
     del proyecto), y caduca a los **15 s**;
   - solo si hay marca de sesión local; **iniciar sesión, registrarse, cerrar sesión o recibir un 401 descartan
     todo lo adelantado** (`clearEarly`), de modo que nada pedido con una sesión llega a otra;
   - la API sigue decidiendo el acceso (404/403/401 llegan igual que sin adelantar).
   La sesión (`/api/auth/me`) se adelanta con `<link rel="preload" as="fetch" crossorigin>`.
3. **Tema sin destello.** `public/assets/theme-init.v1.js` (la CSP no admite scripts en línea) aplica el tema
   guardado antes del primer pintado; solo lee la preferencia. Vive en `/assets/` para que Caddy lo sirva con
   caché inmutable. Si su lógica cambia, se publica como `theme-init.v2.js` y se actualiza `index.html`.
4. **Logo** en WebP (18 KB) con PNG de respaldo, 504×168 (3:1) y dimensiones declaradas (sin saltos de diseño).
5. **Precarga**: al apuntar a un enlace del menú y, en reposo (3 s después de mostrar el proyecto), Apuestas,
   Reportes y Finanzas; nunca con «ahorro de datos».

## Consecuencias

- Verificar la web publicada exige tolerar el script de analítica que Cloudflare inyecta en el HTML
  (`deploy.ps1` compara el HTML sin ese script y descarga cada recurso referenciado).
- Cada despliegue crea nuevos nombres de fragmentos: son más archivos, pero solo se piden los de la sección abierta.
- No se cambió ninguna cifra, fórmula, permiso ni endpoint.
