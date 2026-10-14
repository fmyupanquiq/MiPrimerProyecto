# Arnés de evaluación de la lectura de tickets

Mide **si la IA lee bien** un ticket, comparando lo que debía extraerse con lo que se obtuvo,
campo por campo. No sustituye al validador:

| Pieza                                   | Pregunta que responde                                            |
| --------------------------------------- | ---------------------------------------------------------------- |
| `src/ai/ticket-extraction-validator.ts` | ¿La respuesta es estructural y semánticamente **aceptable**?     |
| este arnés                              | ¿La respuesta **coincide** con lo que realmente decía el ticket? |

Una cuota `1.85` leída donde decía `1.95` es perfectamente válida para el validador y es un error
para el arnés. **Este arnés nunca llama a Anthropic**: trabaja con respuestas ya guardadas.

## Estructura

```
test/ticket-eval/
  types.ts               tipos del arnés (reutiliza TicketExtraction de @letfer/shared)
  compare-extraction.ts  comparador campo a campo (igualdad estricta)
  report.ts              métricas, comparación entre versiones y formato del informe
  load-cases.ts          lectura de casos en disco + paso de lo obtenido por el validador
  run-eval.ts            evalúa una ejecución (etiqueta) sobre los casos
  cases/                 casos SINTÉTICOS (versionados): prueban el propio arnés
  cases-local/           casos REALES (Git los ignora): capturas y lecturas de tus tickets
```

## Cómo se evalúa

Por cada ticket se puntúan 10 campos escalares (`house`, `placedDate`, `placedTime`, `betType`,
`officialTotalOdds`, `officialAmount`, `stake`, `officialPotentialReturn`,
`officialRealizedReturn`, `result`) y, **por posición**, 5 campos de cada selección (`sport`,
`event`, `market`, `selection`, `visibleOdds`). Cada dato recibe un resultado:

| Resultado        | Significado                                              |
| ---------------- | -------------------------------------------------------- |
| `CORRECT`        | Esperado y obtenido, idénticos                           |
| `CORRECT_ABSENT` | No debía extraerse y no se extrajo (omisión correcta)    |
| `INCORRECT`      | Esperado y obtenido, distintos                           |
| `MISSING`        | Debía extraerse y falta                                  |
| `UNEXPECTED`     | No debía extraerse (no aparece o es ilegible) y apareció |

- **Igualdad estricta**: sin recortar, sin ignorar mayúsculas, sin normalizar dinero ni cuotas
  (`1.5` ≠ `1.50`, `10.00` ≠ `S/10.00`). Una comparación “inteligente” podría ocultar el error.
- **Precisión** = (`CORRECT` + `CORRECT_ABSENT`) ÷ datos puntuados. **Lectura correcta** =
  `CORRECT` ÷ (`CORRECT` + `INCORRECT` + `MISSING`), es decir, de lo que sí había que leer, cuánto
  se leyó bien.
- Una respuesta que el validador **rechazaría** se evalúa como extracción vacía (el usuario no
  recibiría nada) y el informe la marca como rechazada.
- Selecciones: se informa qué selección (`#n`) y qué campos fallaron; una selección de más cuenta
  como inesperada y una que falta, como faltante.

## Formato de un caso

```
cases-local/<id-del-caso>/
  case.json            metadatos + extracción esperada (ver abajo)
  ticket.png           captura original (opcional; meta.imageFile)
  actual/<etiqueta>.json   lo que leyó la IA en esa ejecución
```

`case.json`:

```jsonc
{
  "meta": { "id": "<igual que la carpeta>", "description": "…", "house": "…", "screen": "detalle" },
  "expected": {/* la extracción CORRECTA, con la forma de TicketExtraction */},
  "ignoredFields": ["officialRealizedReturn"], // no relevantes: no se puntúan
  "absentFields": { "stake": "NOT_IN_TICKET" }, // ausentes a propósito (NOT_IN_TICKET | UNREADABLE)
  "knownErrors": [
    {
      "path": "selections[1].visibleOdds",
      "read": "1.85",
      "explanation": "La cuota de esa fila es 1.80",
    },
  ],
}
```

Un campo ausente de `expected` significa **“no debe extraerse”**: si la IA lo devuelve, es un dato
inesperado. `actual/<etiqueta>.json` es el `input` que devolvió la herramienta (con o sin
`confidenceByField`); se pasa por el mismo validador de producción antes de evaluarse. Ver el caso
sintético `cases/sintetico-multiple-pendiente/`.

## Añadir un ticket real

1. Crea `cases-local/<id>/` (por ejemplo `betano-combinada-5-perdida-01`).
2. Copia la captura **ocultando solo datos personales con rectángulos negros** (titular, cuenta,
   saldo, QR/ID de cuenta). No alteres cuotas, importes, fechas ni el diseño. Guárdala como
   `ticket.png` y decláralo en `meta.imageFile`.
3. Escribe `case.json` con lo que el ticket dice de verdad (`expected`). Si algo no se ve o no
   aparece, **no lo pongas** y, si quieres, anótalo en `absentFields`.
4. Guarda lo que leyó la IA en `actual/<etiqueta>.json` (p. ej. `baseline`, copiando el
   `extraction` del análisis). Cuando haya una nueva versión del prompt, su lectura va en otro
   archivo (`prompt-v2.json`).
5. Documenta el error observado en `knownErrors` (qué leyó, por qué es incorrecto).

## Ejecutar

Desde `apps/api` (la base de datos de pruebas se levanta con `npm run db:start` en la raíz; estas
pruebas no la usan, pero el `globalSetup` de vitest sí):

```powershell
# PowerShell
$env:EVAL_RUN='baseline'; npx vitest run test/ticket-eval/eval-cases.spec.ts --silent=false --reporter=verbose
# Comparar una versión nueva contra la anterior (regresiones dato a dato)
$env:EVAL_RUN='prompt-v2'; $env:EVAL_BASELINE='baseline'; npx vitest run test/ticket-eval/eval-cases.spec.ts --silent=false --reporter=verbose
# Guardar el informe en JSON, o incluir los casos sintéticos
$env:EVAL_OUT='informe.json'; $env:EVAL_SYNTHETIC='1'; ...
```

```bash
# bash
EVAL_RUN=baseline EVAL_SYNTHETIC=1 npx vitest run test/ticket-eval/eval-cases.spec.ts --silent=false --reporter=verbose
```

El informe se imprime en consola (`--silent=false --reporter=verbose` es necesario: vitest oculta la salida de las pruebas que pasan). Sin `EVAL_RUN`, la suite normal (`npm test`) solo comprueba que los casos están bien formados y que
su `expected` es aceptable para el validador.
