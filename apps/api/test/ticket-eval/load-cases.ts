import { access, readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  validateTicketExtraction,
  type TicketExtractionIssue,
} from '../../src/ai/ticket-extraction-validator.js';
import {
  SELECTION_FIELDS,
  isEvalFieldKey,
  type AbsenceReason,
  type EvalActual,
  type EvalCase,
  type EvalFieldKey,
  type KnownError,
} from './types.js';

/**
 * Formato en disco de un caso (ver README.md):
 *
 *   <raíz>/<id-del-caso>/case.json            metadatos + extracción esperada
 *   <raíz>/<id-del-caso>/<imagen>             captura original (opcional, `meta.imageFile`)
 *   <raíz>/<id-del-caso>/actual/<etiqueta>.json   lo que leyó la IA en esa ejecución
 *
 * `cases/` (versionada) solo lleva casos sintéticos. Los tickets reales van en `cases-local/`,
 * que Git ignora: nunca se suben capturas ni datos reales al repositorio.
 */
export const DEFAULT_CASE_ROOTS = [
  fileURLToPath(new URL('./cases', import.meta.url)),
  fileURLToPath(new URL('./cases-local', import.meta.url)),
];

export interface LoadedCase {
  dir: string;
  evalCase: EvalCase;
  /** Ruta absoluta de la imagen original, si el caso la declara. */
  imagePath?: string;
  /** Etiquetas de ejecución disponibles en `actual/`. */
  actualLabels: string[];
}

const ABSENCE_REASONS: readonly AbsenceReason[] = ['NOT_IN_TICKET', 'UNREADABLE'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const exists = (file: string): Promise<boolean> =>
  access(file).then(
    () => true,
    () => false,
  );

/** ¿La extracción esperada contiene ese campo (escalar, o subcampo de alguna selección)? */
function expectedHas(expected: EvalCase['expected'], field: EvalFieldKey): boolean {
  if (field.startsWith('selections[].')) {
    const sub = field.slice('selections[].'.length) as (typeof SELECTION_FIELDS)[number];
    return (expected.selections ?? []).some((s) => s[sub] !== undefined);
  }
  return (expected as Record<string, unknown>)[field] !== undefined;
}

/** Valida el JSON de `case.json`; lanza un error que nombra el caso y el problema. */
export function parseCase(json: unknown, dirName: string): EvalCase {
  const fail = (message: string): never => {
    throw new Error(`Caso "${dirName}": ${message}`);
  };
  if (!isRecord(json)) return fail('case.json debe ser un objeto.');
  const { meta, expected, ignoredFields, absentFields, knownErrors } = json;
  if (!isRecord(meta)) return fail('falta "meta".');
  if (meta['id'] !== dirName) return fail(`meta.id debe ser "${dirName}" (igual a su carpeta).`);
  if (typeof meta['description'] !== 'string' || meta['description'].trim() === '') {
    return fail('meta.description es obligatoria.');
  }
  if (meta['imageFile'] !== undefined && typeof meta['imageFile'] !== 'string') {
    return fail('meta.imageFile debe ser texto.');
  }
  if (!isRecord(expected)) return fail('falta "expected" (la extracción correcta).');

  const parsed = json as unknown as EvalCase;

  if (ignoredFields !== undefined) {
    if (!Array.isArray(ignoredFields)) return fail('ignoredFields debe ser una lista.');
    for (const field of ignoredFields as unknown[]) {
      if (typeof field !== 'string' || !isEvalFieldKey(field)) {
        return fail(`ignoredFields contiene un campo desconocido: ${JSON.stringify(field)}.`);
      }
    }
  }
  if (absentFields !== undefined) {
    if (!isRecord(absentFields)) return fail('absentFields debe ser un objeto.');
    for (const [field, reason] of Object.entries(absentFields)) {
      if (!isEvalFieldKey(field))
        return fail(`absentFields tiene un campo desconocido: "${field}".`);
      if (!ABSENCE_REASONS.includes(reason as AbsenceReason)) {
        return fail(`absentFields.${field} debe ser NOT_IN_TICKET o UNREADABLE.`);
      }
      if (expectedHas(parsed.expected, field)) {
        return fail(`"${field}" está en absentFields pero también en expected.`);
      }
    }
  }
  if (knownErrors !== undefined) {
    if (!Array.isArray(knownErrors)) return fail('knownErrors debe ser una lista.');
    for (const entry of knownErrors as unknown[]) {
      const known = entry as Partial<KnownError> | null;
      if (
        !isRecord(known) ||
        typeof known.path !== 'string' ||
        typeof known.explanation !== 'string'
      ) {
        return fail('cada knownErrors necesita "path" y "explanation".');
      }
    }
  }
  return parsed;
}

/**
 * Problemas de la extracción ESPERADA según el validador. Un `expected` que el propio validador
 * rechazaría suele ser una errata del fixture (fecha imposible, cuota con coma, etc.).
 */
export function expectedProblems(evalCase: EvalCase): TicketExtractionIssue[] {
  const result = validateTicketExtraction(evalCase.expected, null);
  return result.ok ? [] : result.issues;
}

/**
 * Convierte una respuesta obtenida (el `input` de la herramienta, con o sin `confidenceByField`)
 * en lo que se evalúa, pasándola por el MISMO validador de producción: si lo habría rechazado, el
 * usuario no recibiría nada. No reemplaza al validador; lo usa.
 */
export function toEvalActual(raw: unknown): EvalActual {
  if (!isRecord(raw)) {
    const result = validateTicketExtraction(raw, null);
    return result.ok
      ? { status: 'VALID', extraction: result.extraction }
      : { status: 'REJECTED', issues: result.issues };
  }
  const { confidenceByField, ...extraction } = raw;
  const result = validateTicketExtraction(extraction, confidenceByField);
  return result.ok
    ? { status: 'VALID', extraction: result.extraction }
    : { status: 'REJECTED', issues: result.issues };
}

export async function loadCases(
  roots: readonly string[] = DEFAULT_CASE_ROOTS,
): Promise<LoadedCase[]> {
  const loaded: LoadedCase[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    if (!(await exists(root))) continue;
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries
      .filter((e) => e.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const dir = path.join(root, entry.name);
      const caseFile = path.join(dir, 'case.json');
      if (!(await exists(caseFile))) continue;
      if (seen.has(entry.name)) {
        throw new Error(`Caso "${entry.name}" repetido en más de una raíz de casos.`);
      }
      seen.add(entry.name);

      const evalCase = parseCase(
        JSON.parse(await readFile(caseFile, 'utf8')) as unknown,
        entry.name,
      );
      let imagePath: string | undefined;
      if (evalCase.meta.imageFile) {
        imagePath = path.join(dir, evalCase.meta.imageFile);
        if (!(await exists(imagePath))) {
          throw new Error(
            `Caso "${entry.name}": no existe la imagen "${evalCase.meta.imageFile}".`,
          );
        }
      }
      const actualDir = path.join(dir, 'actual');
      const actualLabels = (await exists(actualDir))
        ? (await readdir(actualDir))
            .filter((f) => f.endsWith('.json'))
            .map((f) => f.slice(0, -'.json'.length))
            .sort()
        : [];
      loaded.push({ dir, evalCase, ...(imagePath ? { imagePath } : {}), actualLabels });
    }
  }
  return loaded;
}

/** Lo obtenido por la ejecución `label` en este caso; `undefined` si no hay archivo para esa etiqueta. */
export async function loadActual(
  loaded: LoadedCase,
  label: string,
): Promise<EvalActual | undefined> {
  if (!loaded.actualLabels.includes(label)) return undefined;
  const file = path.join(loaded.dir, 'actual', `${label}.json`);
  return toEvalActual(JSON.parse(await readFile(file, 'utf8')) as unknown);
}
