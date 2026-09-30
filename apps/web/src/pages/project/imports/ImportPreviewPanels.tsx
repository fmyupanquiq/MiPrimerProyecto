import {
  type BatchFinancialSemaphore,
  type ExcelFinancialContrastReport,
  formatPEN,
  type ImportDuplicateMatch,
  type ImportDuplicateReport,
  type ImportPreview,
  type ImportPreviewBet,
  type ImportRowValidationEntry,
  type ImportSemaphore,
  type MoneyString,
} from '@letfer/shared';
import type { Loaded } from '../../../hooks/useLoad.js';
import {
  BET_STATUS_LABELS,
  BET_TYPE_LABELS,
  IMPORT_ROW_CATEGORY_LABELS,
  IMPORT_ROW_STATUS_LABELS,
  IMPORT_SEMAPHORE_LABELS,
} from '../../../labels.js';
import { Badge, Notice, Section } from '../../../ui.js';
import { FinancialSemaphoreBadge } from './ImportsCommon.js';

/*
 * Vista previa de un lote (§113.6, Fase 9.4.5). Solo presenta lo que devuelve
 * `GET /import-batches/:id/preview`: los semáforos, residuos y clasificaciones los decide la API
 * (D-X17b, §113.7, D-X10). Aquí solo se cuentan o cruzan por número de fila datos ya entregados,
 * para mostrarlos juntos; nunca se recalcula una regla.
 */

const SEMAPHORE_TONES: Record<ImportSemaphore, 'green' | 'amber' | 'red'> = {
  OK: 'green',
  NEEDS_ACKNOWLEDGMENT: 'amber',
  BLOCKED: 'red',
};

const SEMAPHORE_HELP: Record<ImportSemaphore, string> = {
  OK: 'Ninguna fila tiene errores ni está incompleta.',
  NEEDS_ACKNOWLEDGMENT:
    'Hay filas parciales: no bloquean, pero para confirmar hará falta un reconocimiento explícito con motivo.',
  BLOCKED: 'Hay filas con errores: el lote no puede confirmarse tal como está.',
};

const FINANCIAL_HELP: Record<BatchFinancialSemaphore, string> = {
  GREEN: 'Las cifras del archivo coinciden con las de LetFer dentro de un centavo.',
  YELLOW:
    'La suma de residuos supera un centavo, pero se explica por valores del archivo con más de dos decimales. Solo informa.',
  RED: 'Hay diferencias que no se explican por redondeo. No bloquea, pero para confirmar hará falta un reconocimiento explícito con motivo.',
};

/**
 * Cifras del archivo y residuos, tal como llegan de la API. No se redondean a dos decimales: el
 * archivo no redondea (§113.7) y el residuo existe justamente para mostrar esas fracciones.
 */
const exact = (value: MoneyString | null) => (value === null ? '—' : `S/ ${value}`);

const th = 'py-1 pr-3 font-medium';
const td = 'py-1 pr-3 align-top';

/** La vista previa ya pedida por la página (que la recarga tras corregir la casa del lote). */
export function ImportPreviewSection({ preview }: { preview: Loaded<ImportPreview> }) {
  if (preview.loading && !preview.data) return <p>Cargando vista previa…</p>;
  if (!preview.data) {
    return (
      <Notice tone="error">{preview.error ?? 'No se pudo cargar la vista previa del lote.'}</Notice>
    );
  }

  const data = preview.data;
  return (
    <>
      <PreviewSummary preview={data} />
      <StructuralStatus semaphore={data.semaphore} rows={data.rows} />
      <FinancialContrast report={data.financialContrast} />
      <PreliminaryBets preview={data} />
      <Duplicates report={data.duplicates} />
    </>
  );
}

function PreviewSummary({ preview }: { preview: ImportPreview }) {
  const { summary } = preview;
  const typeWarnings = preview.rows.filter((row) => row.typeMismatch).length;

  return (
    <Section title="Resumen de la vista previa">
      <dl className="grid gap-3 text-sm sm:grid-cols-4">
        <div className="sm:col-span-2">
          <dt className="text-slate-600">Archivo</dt>
          <dd className="break-all">
            {preview.file.originalName} · {preview.origin}
          </dd>
        </div>
        <div>
          <dt className="text-slate-600">Filas</dt>
          <dd className="text-lg font-medium">{summary.totalRows}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Apuestas preliminares</dt>
          <dd className="text-lg font-medium">{summary.preliminaryBets}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Ignoradas</dt>
          <dd>
            {summary.template} de plantilla · {summary.empty} vacías
          </dd>
        </div>
        <div>
          <dt className="text-slate-600">Parciales</dt>
          <dd className="text-lg font-medium">{summary.partial}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Con errores</dt>
          <dd className="text-lg font-medium">{summary.invalid}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Avisos de tipo</dt>
          <dd className="text-lg font-medium">{typeWarnings}</dd>
        </div>
      </dl>
    </Section>
  );
}

function StructuralStatus({
  semaphore,
  rows,
}: {
  semaphore: ImportSemaphore;
  rows: ImportRowValidationEntry[];
}) {
  const withFindings = rows.filter((row) => row.findings.length > 0);

  return (
    <Section title="Estado estructural">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={SEMAPHORE_TONES[semaphore]}>{IMPORT_SEMAPHORE_LABELS[semaphore]}</Badge>
        <p className="text-sm text-slate-600">{SEMAPHORE_HELP[semaphore]}</p>
      </div>
      {withFindings.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" aria-label="Filas con hallazgos">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className={th}>Fila</th>
                <th className={th}>Clasificación</th>
                <th className={th}>Efecto</th>
                <th className="py-1 font-medium">Hallazgos</th>
              </tr>
            </thead>
            <tbody>
              {withFindings.map((row) => (
                <tr key={row.rowNumber} className="border-b border-slate-100">
                  <td className={td}>{row.rowNumber}</td>
                  <td className={td}>{IMPORT_ROW_STATUS_LABELS[row.status]}</td>
                  <td className={td}>{IMPORT_ROW_CATEGORY_LABELS[row.category]}</td>
                  <td className="py-1 align-top">
                    <ul>
                      {row.findings.map((finding) => (
                        <li key={finding.code}>{finding.message}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function FinancialContrast({ report }: { report: ExcelFinancialContrastReport }) {
  if (!report.configured) {
    return (
      <Section title="Contraste financiero">
        <Notice tone="info">
          Este origen no tiene contraste financiero configurado: no hay cifras del archivo con las
          que comparar.
        </Notice>
      </Section>
    );
  }

  const differing = report.bets.filter((bet) => bet.semaphore === 'RED');

  return (
    <Section title="Contraste financiero">
      <div className="flex flex-wrap items-center gap-2">
        <FinancialSemaphoreBadge semaphore={report.semaphore} />
        <p className="text-sm text-slate-600">{FINANCIAL_HELP[report.semaphore]}</p>
      </div>
      <p className="text-sm text-slate-600">
        LetFer nunca ajusta sus cifras para igualar el archivo: las diferencias solo se informan
        (residuo = archivo − LetFer).
      </p>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-slate-600">Residuo total de ganancia</dt>
          <dd className="text-lg font-medium">{exact(report.totalProfitResidual)}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Filas con más de dos decimales en el archivo</dt>
          <dd className="text-lg font-medium">{report.rowsWithMoreThanTwoDecimals}</dd>
        </div>
        {report.initialBankAmount !== null && (
          <div>
            <dt className="text-slate-600">Bank inicial declarado en el archivo</dt>
            <dd className="text-lg font-medium">{exact(report.initialBankAmount)}</dd>
          </div>
        )}
      </dl>

      {report.headerChecks.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" aria-label="Totales de cabecera">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className={th}>Total de cabecera</th>
                <th className={th}>Archivo</th>
                <th className={th}>Suma de sus filas</th>
                <th className={th}>Residuo</th>
                <th className="py-1 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {report.headerChecks.map((check) => (
                <tr key={check.label} className="border-b border-slate-100">
                  <td className={td}>{check.label}</td>
                  <td className={td}>{exact(check.excelValue)}</td>
                  <td className={td}>{exact(check.expectedFromRows)}</td>
                  <td className={td}>{exact(check.residual)}</td>
                  <td className="py-1">
                    {check.consistent ? (
                      <Badge tone="green">Coincide</Badge>
                    ) : (
                      <Badge tone="red">No coincide</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {differing.length === 0 ? (
        <p className="text-sm text-slate-600">Ninguna fila difiere del archivo.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" aria-label="Filas que difieren del archivo">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className={th}>Fila</th>
                <th className={th}>Retorno (archivo)</th>
                <th className={th}>Retorno (LetFer)</th>
                <th className={th}>Residuo del retorno</th>
                <th className={th}>Ganancia (archivo)</th>
                <th className={th}>Ganancia (LetFer)</th>
                <th className="py-1 font-medium">Residuo de la ganancia</th>
              </tr>
            </thead>
            <tbody>
              {differing.map((bet) => (
                <tr key={bet.rowNumber} className="border-b border-slate-100">
                  <td className={td}>{bet.rowNumber}</td>
                  <td className={td}>{exact(bet.excelTotalReturn)}</td>
                  <td className={td}>{formatPEN(bet.letferTotalReturn)}</td>
                  <td className={td}>{exact(bet.totalReturnResidual)}</td>
                  <td className={td}>{exact(bet.excelProfit)}</td>
                  <td className={td}>{formatPEN(bet.letferProfit)}</td>
                  <td className="py-1">{exact(bet.profitResidual)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/** Avisos de cada apuesta preliminar, reunidos por número de fila desde las demás partes. */
function warningsByRow(preview: ImportPreview): Map<number, string[]> {
  const warnings = new Map<number, string[]>();
  const add = (row: number, message: string) =>
    warnings.set(row, [...(warnings.get(row) ?? []), message]);

  for (const bet of preview.bets) {
    if (bet.typeMismatch) add(bet.rowNumber, 'El tipo declarado no coincide con el derivado.');
  }
  for (const comparison of preview.financialContrast.bets) {
    if (comparison.semaphore === 'RED') {
      add(comparison.rowNumber, 'Difiere del archivo (ver contraste financiero).');
    }
  }
  for (const match of preview.duplicates.withinFile) {
    const rows = match.rowNumbers.join(', ');
    for (const row of match.rowNumbers) {
      add(row, `Posible duplicado dentro del archivo (filas ${rows}).`);
    }
  }
  for (const match of preview.duplicates.againstHistory) {
    for (const row of match.rowNumbers) add(row, 'Posible duplicado de una apuesta ya importada.');
  }
  return warnings;
}

function betType(bet: ImportPreviewBet): string {
  const derived = bet.derivedType ? BET_TYPE_LABELS[bet.derivedType] : 'sin derivar';
  return bet.declaredType ? `${bet.declaredType} → ${derived}` : derived;
}

function sports(bet: ImportPreviewBet): string {
  const names = [...new Set(bet.selections.map((s) => s.sport).filter(Boolean))];
  return names.length > 0 ? names.join(', ') : '—';
}

function PreliminaryBets({ preview }: { preview: ImportPreview }) {
  const warnings = warningsByRow(preview);

  return (
    <Section title="Apuestas preliminares">
      <p className="text-sm text-slate-600">
        Lo que se registraría al confirmar, una apuesta por fila válida. Todavía no existe en el
        ledger.
      </p>
      {preview.bets.length === 0 ? (
        <Notice tone="info">El archivo no tiene filas válidas que importar.</Notice>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" aria-label="Apuestas preliminares">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className={th}>Fila</th>
                <th className={th}>Deporte</th>
                <th className={th}>Tipo (declarado → derivado)</th>
                <th className={th}>Selecciones</th>
                <th className={th}>Monto</th>
                <th className={th}>Cuota</th>
                <th className={th}>Estado</th>
                <th className={th}>Retorno provisional</th>
                <th className="py-1 font-medium">Avisos</th>
              </tr>
            </thead>
            <tbody>
              {preview.bets.map((bet) => {
                const rowWarnings = warnings.get(bet.rowNumber) ?? [];
                return (
                  <tr key={bet.rowNumber} className="border-b border-slate-100">
                    <td className={td}>{bet.rowNumber}</td>
                    <td className={td}>{sports(bet)}</td>
                    <td className={td}>{betType(bet)}</td>
                    <td className={td}>
                      <ul>
                        {bet.selections.map((selection) => (
                          <li key={`${selection.eventGroup}-${selection.position}`}>
                            {selection.event} — {selection.selection}
                            {selection.market && (
                              <span className="text-slate-500"> ({selection.market})</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className={td}>{formatPEN(bet.amount)}</td>
                    <td className={td}>{bet.visibleTotalOdds}</td>
                    <td className={td}>{BET_STATUS_LABELS[bet.status]}</td>
                    <td className={td}>
                      {bet.provisionalReturn === null ? (
                        '—'
                      ) : (
                        <div className="flex flex-col items-start gap-1">
                          {formatPEN(bet.provisionalReturn)}
                          <Badge tone="amber">Calculado, sin confirmar</Badge>
                        </div>
                      )}
                    </td>
                    <td className="py-1 align-top">
                      {rowWarnings.length === 0 ? (
                        '—'
                      ) : (
                        <ul className="text-amber-800">
                          {rowWarnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function DuplicateTable({ label, matches }: { label: string; matches: ImportDuplicateMatch[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" aria-label={label}>
        <thead>
          <tr className="border-b border-slate-200 text-slate-600">
            <th className={th}>Filas</th>
            <th className={th}>Fecha</th>
            <th className={th}>Monto</th>
            <th className="py-1 font-medium">Cuota</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((match) => (
            <tr key={match.rowNumbers.join('-')} className="border-b border-slate-100">
              <td className={td}>{match.rowNumbers.join(', ')}</td>
              {/* Fecha de calendario en la zona del proyecto (AAAA-MM-DD), tal como la da la API. */}
              <td className={td}>{match.date}</td>
              <td className={td}>{formatPEN(match.amount)}</td>
              <td className="py-1">{match.odds}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Duplicates({ report }: { report: ImportDuplicateReport }) {
  const none = report.withinFile.length === 0 && report.againstHistory.length === 0;

  return (
    <Section title="Posibles duplicados">
      <p className="text-sm text-slate-600">
        Apuestas con la misma fecha, monto, cuota y selecciones. Solo se informan: nada se descarta
        ni se fusiona. La comparación con lo ya importado se hace cuando la casa del lote está
        confirmada.
      </p>
      {none && <Notice tone="success">No se detectaron posibles duplicados.</Notice>}
      {report.withinFile.length > 0 && (
        <>
          <h3 className="text-sm font-medium">Dentro del archivo</h3>
          <DuplicateTable label="Duplicados dentro del archivo" matches={report.withinFile} />
        </>
      )}
      {report.againstHistory.length > 0 && (
        <>
          <h3 className="text-sm font-medium">Contra apuestas ya importadas</h3>
          <DuplicateTable
            label="Duplicados contra lo ya importado"
            matches={report.againstHistory}
          />
        </>
      )}
    </Section>
  );
}
