import type { ReactNode } from 'react';
import { ChevronDownIcon } from '../../../icons.js';

/** Select compacto de la cabecera de una tarjeta. */
export function CompactSelect<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  icon,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  ariaLabel: string;
  icon?: ReactNode;
}) {
  return (
    <span className="relative inline-flex items-center">
      {icon && (
        <span className="pointer-events-none absolute left-2 text-slate-500" aria-hidden="true">
          {icon}
        </span>
      )}
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className={`h-8 appearance-none rounded-lg border border-slate-200 bg-surface pr-6 text-[0.6875rem] font-medium text-slate-700 transition-colors hover:border-violet-300 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-500 ${
          icon ? 'pl-6' : 'pl-2.5'
        }`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon
        className="pointer-events-none absolute right-1.5 h-3.5 w-3.5 text-slate-500"
        aria-hidden="true"
      />
    </span>
  );
}
