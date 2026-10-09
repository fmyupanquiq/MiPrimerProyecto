import type { ImportBatchSummaryRow, ImportConfirmationReadiness } from '@letfer/shared';
import { AlertIcon, CheckIcon, XCircleIcon } from '../../../icons.js';
import { savedPlan } from './ImportResolutionPanels.js';

type StepState = 'done' | 'current' | 'todo' | 'blocked' | 'skipped';

interface Step {
  title: string;
  state: StepState;
  detail: string;
}

/**
 * Pasos del lote, derivados solo de lo que ya dicen el lote y la API (`readiness`): las mismas
 * condiciones que exige "Confirmar importación" (`ConfirmationPanel`). No decide nada: orienta.
 */
export function importSteps(
  batch: ImportBatchSummaryRow,
  readiness: ImportConfirmationReadiness | null,
): Step[] {
  const imported = batch.status === 'IMPORTED' || batch.status === 'ANNULLED';
  const houseDone = batch.status !== 'UPLOADED';
  const planDone = savedPlan(batch) !== null;

  const ack: Step = !readiness
    ? { title: 'Revisar avisos', state: 'todo', detail: 'Comprobando el lote…' }
    : readiness.blocked
      ? {
          title: 'Revisar avisos',
          state: 'blocked',
          detail: 'Hay filas con errores: el archivo no puede importarse así.',
        }
      : readiness.needsAcknowledgment
        ? readiness.acknowledged
          ? { title: 'Reconocer avisos', state: 'done', detail: 'Reconocidos con motivo.' }
          : {
              title: 'Reconocer avisos',
              state: 'todo',
              detail: 'Hay avisos que necesitan una confirmación explícita.',
            }
        : { title: 'Revisar avisos', state: 'skipped', detail: 'Nada que reconocer.' };

  const steps: Step[] = [
    { title: 'Subir archivo', state: 'done', detail: batch.originalName },
    {
      title: 'Confirmar casa',
      state: houseDone ? 'done' : 'todo',
      detail: houseDone ? 'Casa confirmada.' : 'Elige a qué casa pertenece el historial.',
    },
    {
      title: 'Plan de etapas',
      state: planDone ? 'done' : 'todo',
      detail: planDone ? 'Plan guardado.' : 'Indica en qué etapa cae cada periodo.',
    },
    imported ? { ...ack, state: ack.state === 'blocked' ? 'done' : ack.state } : ack,
    {
      title: 'Confirmar importación',
      state: imported ? 'done' : 'todo',
      detail: imported
        ? batch.status === 'ANNULLED'
          ? 'Importado y después anulado.'
          : 'Registrado en el ledger.'
        : 'Registra las apuestas y movimientos en el ledger.',
    },
  ];
  // El primer paso pendiente es el actual (lo siguiente que hay que hacer).
  const next = steps.findIndex((step) => step.state === 'todo');
  if (next >= 0) steps[next] = { ...steps[next]!, state: 'current' };
  return steps;
}

const STATE_STYLE: Record<StepState, string> = {
  done: 'bg-green-600 text-white',
  skipped: 'bg-slate-200 text-slate-600',
  current: 'bg-violet-600 text-white ring-4 ring-violet-500/20',
  todo: 'bg-slate-100 text-slate-500 ring-1 ring-slate-300 ring-inset',
  blocked: 'bg-red-600 text-white',
};

const STATE_LABEL: Record<StepState, string> = {
  done: 'Hecho',
  skipped: 'No hace falta',
  current: 'Siguiente paso',
  todo: 'Pendiente',
  blocked: 'Bloqueado',
};

/** Semáforo de la confirmación: el mismo veredicto que da la API, explicado en palabras. */
function verdict(readiness: ImportConfirmationReadiness | null) {
  if (!readiness) return null;
  if (readiness.blocked) {
    return {
      tone: 'border-red-200 bg-red-50 text-red-800',
      icon: <XCircleIcon className="h-5 w-5" />,
      title: 'Bloqueado',
      text: 'Hay problemas que deben resolverse en el archivo antes de continuar.',
    };
  }
  if (readiness.needsAcknowledgment && !readiness.acknowledged) {
    return {
      tone: 'border-amber-200 bg-amber-50 text-amber-900',
      icon: <AlertIcon className="h-5 w-5" />,
      title: 'Requiere reconocimiento',
      text: 'Hay elementos que necesitan una confirmación explícita, con motivo, antes de importar.',
    };
  }
  return {
    tone: 'border-green-200 bg-green-50 text-green-800',
    icon: <CheckIcon className="h-5 w-5" />,
    title: 'Listo para continuar',
    text: 'El archivo no tiene bloqueos: completa los pasos pendientes y confirma la importación.',
  };
}

/** Recorrido del lote: dónde estás, qué está hecho y cuál es el siguiente paso. */
export function ImportProgress({
  batch,
  readiness,
}: {
  batch: ImportBatchSummaryRow;
  readiness: ImportConfirmationReadiness | null;
}) {
  const steps = importSteps(batch, readiness);
  const open = batch.status === 'UPLOADED' || batch.status === 'VALIDATED';
  const status = open ? verdict(readiness) : null;

  return (
    <section
      aria-label="Progreso de la importación"
      className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm sm:p-5"
    >
      <h2 className="text-base font-semibold">Progreso de la importación</h2>
      <ol className="grid gap-3 sm:grid-cols-5">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className="flex items-start gap-2 sm:flex-col"
            aria-current={step.state === 'current' ? 'step' : undefined}
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${STATE_STYLE[step.state]}`}
              aria-hidden="true"
            >
              {step.state === 'done' ? (
                <CheckIcon className="h-4 w-4" />
              ) : step.state === 'blocked' ? (
                '!'
              ) : (
                index + 1
              )}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-900">{step.title}</span>
              <span className="block text-xs text-slate-500">
                <span className="sr-only">{STATE_LABEL[step.state]}: </span>
                {step.detail}
              </span>
            </span>
          </li>
        ))}
      </ol>
      {status && (
        <div
          role="status"
          className={`flex items-start gap-2.5 rounded-xl border p-3 text-sm ${status.tone}`}
          aria-label="Estado para confirmar"
        >
          <span className="shrink-0" aria-hidden="true">
            {status.icon}
          </span>
          <p>
            <strong>{status.title}.</strong> {status.text}
          </p>
        </div>
      )}
    </section>
  );
}
