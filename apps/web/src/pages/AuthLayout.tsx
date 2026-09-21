import { SYSTEM_NAME } from '@letfer/shared';
import type { ReactNode } from 'react';

/** Marco provisional de las pantallas de acceso. El diseño visual definitivo llega después (§62). */
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6">
      <header className="text-center">
        <p className="text-sm font-medium tracking-wide text-slate-500">{SYSTEM_NAME}</p>
        <h1 className="text-2xl font-semibold">{title}</h1>
      </header>
      {children}
    </main>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
      {message}
    </p>
  );
}

export const inputClass = 'w-full rounded border border-slate-300 px-3 py-2';
export const buttonClass =
  'w-full rounded bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-50';
export const linkClass = 'text-sm text-slate-600 underline';
