import { useEffect, useId, useRef, useState } from 'react';
import { CalendarIcon, CheckIcon, ChevronDownIcon } from '../../../icons.js';
import { inputClass } from '../../../ui.js';
import {
  isCalendarDate,
  presetRange,
  RANGE_PRESETS,
  rangeLabel,
  type DateRange,
} from './date-range.js';

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500';

/**
 * Selector del rango de fechas del Dashboard: botón con el rango actual y un panel con los atajos y
 * un rango personalizado (días de la zona del proyecto). Se cierra con Escape o al pulsar fuera.
 */
export function DateRangePicker({
  value,
  today,
  onChange,
}: {
  value: DateRange;
  /** Hoy en la zona del proyecto (`AAAA-MM-DD`). */
  today: string;
  onChange: (range: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState(value.from ?? today);
  const [to, setTo] = useState(value.to ?? today);
  const container = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    if (!open) {
      setCustom(value.preset === 'CUSTOM');
      setFrom(value.from ?? today);
      setTo(value.to ?? today);
    }
    setOpen(!open);
  };

  const choose = (range: DateRange) => {
    onChange(range);
    setOpen(false);
    button.current?.focus();
  };

  const customValid = isCalendarDate(from) && isCalendarDate(to) && from <= to && to <= today;

  return (
    <div ref={container} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`Rango de fechas: ${rangeLabel(value)}`}
        onClick={toggle}
        className={`inline-flex h-10 items-center gap-2.5 rounded-lg border border-slate-200 bg-surface px-3.5 text-sm font-medium text-slate-800 transition-colors hover:border-violet-300 ${focusRing}`}
      >
        <CalendarIcon className="h-4.5 w-4.5 text-slate-500" />
        <span className="tabular-nums">{rangeLabel(value)}</span>
        <ChevronDownIcon className="h-4 w-4 text-slate-500" />
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Elegir rango de fechas"
          className="absolute right-0 z-40 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-surface p-2 shadow-xl"
        >
          <ul className="flex flex-col" aria-label="Atajos de rango">
            {RANGE_PRESETS.map((preset) => {
              const selected = !custom && value.preset === preset.key;
              return (
                <li key={preset.key}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => choose(presetRange(preset.key, today))}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${focusRing} ${
                      selected
                        ? 'bg-violet-100 font-medium text-violet-800'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {preset.label}
                    {selected && <CheckIcon className="h-4 w-4" />}
                  </button>
                </li>
              );
            })}
            <li>
              <button
                type="button"
                aria-pressed={custom || value.preset === 'CUSTOM'}
                onClick={() => setCustom(true)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${focusRing} ${
                  custom || value.preset === 'CUSTOM'
                    ? 'bg-violet-100 font-medium text-violet-800'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                Personalizado
              </button>
            </li>
          </ul>
          {custom && (
            <form
              className="mt-2 flex flex-col gap-2 border-t border-slate-200 px-1 pt-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (customValid) choose({ preset: 'CUSTOM', from, to });
              }}
            >
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Desde
                <input
                  type="date"
                  className={inputClass}
                  value={from}
                  max={today}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Hasta
                <input
                  type="date"
                  className={inputClass}
                  value={to}
                  max={today}
                  onChange={(event) => setTo(event.target.value)}
                />
              </label>
              {!customValid && (
                <p className="text-xs text-red-700">
                  Elige un «Desde» anterior o igual al «Hasta», sin pasar de hoy.
                </p>
              )}
              <button
                type="submit"
                disabled={!customValid}
                className={`mt-1 h-9 rounded-lg bg-violet-600 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50 ${focusRing}`}
              >
                Aplicar
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
