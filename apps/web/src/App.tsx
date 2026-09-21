import { SYSTEM_NAME } from '@letfer/shared';

/** Página provisional de la Fase 0: no contiene lógica de negocio ni diseño definitivo. */
export function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-3xl font-semibold">{SYSTEM_NAME}</h1>
      <p className="text-slate-600">Entorno de desarrollo preparado (Fase 0).</p>
    </main>
  );
}
