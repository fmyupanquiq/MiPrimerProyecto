import type { DashboardStatus } from '@letfer/shared';
import { Link } from 'react-router';
import { CheckIcon } from '../../../icons.js';

interface Step {
  title: string;
  text: string;
  done: boolean;
  /** Dónde se hace, si la persona puede hacerlo. */
  to: string | null;
  action: string;
}

/**
 * Primeros pasos (Fase 10.3): el recorrido natural de un proyecto nuevo, marcado con lo que el
 * sistema ya sabe (setup completo y conteo de apuestas). No es un asistente aparte: cada paso lleva
 * a la pantalla de siempre. Desaparece cuando todo está hecho.
 */
export function GettingStarted({
  projectId,
  setupComplete,
  counts,
  canSetup,
  canCreateBet,
  canSettle,
}: {
  projectId: string;
  setupComplete: boolean;
  /** Conteo real de apuestas; `null` si aún no se conoce (no se muestra nada hasta saberlo). */
  counts: DashboardStatus['conteoApuestas'] | null;
  canSetup: boolean;
  canCreateBet: boolean;
  canSettle: boolean;
}) {
  if (setupComplete && counts === null) return null;
  const base = `/projects/${projectId}`;
  const hasBets = (counts?.total ?? 0) > 0;
  const hasSettled = counts !== null && counts.total - counts.pending > 0;

  const steps: Step[] = [
    {
      title: 'Crear el proyecto',
      text: 'Ya está creado.',
      done: true,
      to: null,
      action: '',
    },
    {
      title: 'Configurar etapa, casas y banca',
      text: 'La unidad de stake de la Etapa 1 y cuánto dinero hay en cada casa.',
      done: setupComplete,
      to: canSetup ? `${base}/setup` : null,
      action: 'Completar configuración',
    },
    {
      title: 'Registrar la primera apuesta',
      text: 'Casa, partido, stake y cuota: LetFer calcula el importe.',
      done: hasBets,
      to: setupComplete && canCreateBet ? `${base}/bets?nueva=1` : null,
      action: 'Añadir apuesta',
    },
    {
      title: 'Liquidar una apuesta',
      text: 'Cuando termine el evento, marca si ganó, perdió o se anuló.',
      done: hasSettled,
      to: hasBets && canSettle ? `${base}/bets` : null,
      action: 'Ir a Apuestas',
    },
  ];
  if (steps.every((step) => step.done)) return null;
  const current = steps.findIndex((step) => !step.done);
  const doneCount = steps.filter((step) => step.done).length;

  return (
    <section
      aria-labelledby="getting-started-title"
      className="flex flex-col gap-4 rounded-2xl border border-violet-200 bg-surface p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="getting-started-title" className="text-base font-semibold">
            Primeros pasos
          </h2>
          <p className="text-sm text-slate-500">Completa estos pasos para empezar a usar LetFer.</p>
        </div>
        <p className="text-sm text-slate-500" aria-live="polite">
          {doneCount} de {steps.length} completados
        </p>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100" aria-hidden="true">
        <div
          className="h-1.5 rounded-full bg-violet-600 transition-all"
          style={{ width: `${(doneCount / steps.length) * 100}%` }}
        />
      </div>
      <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Primeros pasos">
        {steps.map((step, index) => {
          const isCurrent = index === current;
          return (
            <li
              key={step.title}
              aria-current={isCurrent ? 'step' : undefined}
              className={`flex flex-col gap-2 rounded-xl border p-3 ${
                isCurrent ? 'border-violet-300 bg-violet-50/60' : 'border-slate-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    step.done
                      ? 'bg-green-600 text-white'
                      : isCurrent
                        ? 'bg-violet-600 text-white'
                        : 'bg-slate-100 text-slate-500 ring-1 ring-slate-300 ring-inset'
                  }`}
                  aria-hidden="true"
                >
                  {step.done ? <CheckIcon className="h-3.5 w-3.5" /> : index + 1}
                </span>
                <span className="text-sm font-medium">
                  {step.title}
                  <span className="sr-only">{step.done ? ' (hecho)' : ' (pendiente)'}</span>
                </span>
              </div>
              <p className="text-xs text-slate-500">{step.text}</p>
              {isCurrent && !step.to && (
                <p className="text-xs font-medium text-slate-600">
                  Lo hace quien tiene permiso en el proyecto.
                </p>
              )}
              {isCurrent && step.to && (
                <Link
                  to={step.to}
                  className="self-start text-sm font-medium text-violet-700 underline hover:text-violet-900"
                >
                  {step.action}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
