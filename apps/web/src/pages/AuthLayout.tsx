import { SYSTEM_NAME } from '@letfer/shared';
import type { ReactNode } from 'react';
import { btn, btnPrimary, inputClass as fieldClass } from '../ui.js';

/**
 * Marco de las pantallas de acceso (inicio de sesión, recuperación, invitación): tarjeta centrada
 * con la marca, sobre el fondo del tema. Mismos campos y botones que el resto de LetFer.
 */
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen w-full items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-md flex-col gap-6">
        <header className="flex flex-col items-center gap-3 text-center">
          <img src="/logo-64.png" alt="" aria-hidden="true" className="h-11 w-11 shrink-0" />
          <p className="text-sm font-medium tracking-wide text-slate-500">{SYSTEM_NAME}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        </header>
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
          {children}
        </div>
      </div>
    </main>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      {message}
    </p>
  );
}

export const inputClass = fieldClass;
export const buttonClass = `${btnPrimary} w-full min-h-10`;
export const secondaryButtonClass = `${btn} w-full min-h-10`;
export const linkClass = 'text-sm text-violet-700 underline hover:text-violet-900';
