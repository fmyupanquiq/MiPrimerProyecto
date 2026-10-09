import {
  formatPEN,
  isMoneyString,
  projectSetupSchema,
  sumMoney,
  type ProjectSetupInput,
} from '@letfer/shared';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { describeApiError } from '../../api/errors.js';
import { projectSetupApi } from '../../api/finance.js';
import { Help } from '../../glossary.js';
import { PlusIcon } from '../../icons.js';
import { btn, btnPrimary, hintClass, inputClass, Notice, PageHeader } from '../../ui.js';
import { FormStep } from './BetSettlementFields.js';
import { useProject } from './ProjectContext.js';

interface HouseRow {
  key: number;
  name: string;
  initialAmount: string;
}

let nextKey = 0;
const newRow = (): HouseRow => ({ key: nextKey++, name: '', initialAmount: '0' });

/**
 * Configuración inicial del proyecto (§5, D1): unidad de la Etapa 1, casas y banca inicial
 * distribuida entre ellas. Hasta completarse, el proyecto no admite movimientos financieros.
 */
export function ProjectSetupPage() {
  const { project, setProject } = useProject();
  const navigate = useNavigate();
  const [unitStake, setUnitStake] = useState('10.00');
  const [houses, setHouses] = useState<HouseRow[]>([newRow()]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Solo para mostrar: suma decimal (nunca `number`) de los montos ya válidos.
  const amounts = houses.map((house) => house.initialAmount.trim());
  const validAmounts = amounts.filter(isMoneyString);
  const total = validAmounts.length > 0 ? sumMoney(validAmounts) : '0.00';
  const hasInvalidAmount = validAmounts.length < amounts.length;

  function updateHouse(key: number, patch: Partial<HouseRow>) {
    setHouses((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const input: ProjectSetupInput = {
      unitStake,
      houses: houses.map((house) => ({ name: house.name, initialAmount: house.initialAmount })),
    };
    const parsed = projectSetupSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisa los datos ingresados.');
      return;
    }
    setSubmitting(true);
    try {
      const updated = await projectSetupApi.complete(project.id, parsed.data);
      setProject(updated);
      void navigate(`/projects/${project.id}`);
    } catch (caught) {
      setError(describeApiError(caught));
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Configuración inicial"
        description="Dos pasos para empezar: cuánto vale un stake y cuánto dinero hay en cada casa. Se hace una sola vez."
      />
      <form
        onSubmit={(event) => void onSubmit(event)}
        className="flex flex-col gap-4"
        aria-label="Configuración inicial"
        noValidate
      >
        <FormStep
          step={1}
          title="¿Cuánto vale un stake?"
          hint="Se creará la Etapa 1 con esta unidad: el valor en soles de un stake 1."
        >
          <div className="flex max-w-xs flex-col gap-1.5">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Unidad de stake de la Etapa 1
              <input
                value={unitStake}
                onChange={(event) => setUnitStake(event.target.value)}
                className={inputClass}
                placeholder="10.00"
                inputMode="decimal"
                aria-describedby="unit-stake-help"
              />
            </label>
            <span id="unit-stake-help" className={`${hintClass} flex items-center gap-1`}>
              Monto teórico de una apuesta = stake × unidad. Ejemplo: unidad 10, stake 1.5 → 15.
              <Help term="unit" />
            </span>
          </div>
        </FormStep>

        <FormStep
          step={2}
          title="¿Dónde está el dinero?"
          hint="Las casas de apuestas donde está el dinero y cuánto hay hoy en cada una. La suma es la banca inicial, que se registra como capital del proyecto."
        >
          <div className="flex flex-col gap-2">
            {houses.map((house, index) => (
              <div key={house.key} className="flex flex-wrap items-end gap-2">
                <label className="flex min-w-40 flex-1 flex-col gap-1.5 text-sm font-medium">
                  {index === 0 ? 'Nombre' : ''}
                  <input
                    value={house.name}
                    onChange={(event) => updateHouse(house.key, { name: event.target.value })}
                    className={inputClass}
                    placeholder="Betano"
                    aria-label={`Nombre de la casa ${index + 1}`}
                  />
                </label>
                <label className="flex w-40 flex-col gap-1.5 text-sm font-medium">
                  {index === 0 ? 'Monto inicial' : ''}
                  <input
                    value={house.initialAmount}
                    onChange={(event) =>
                      updateHouse(house.key, { initialAmount: event.target.value })
                    }
                    className={inputClass}
                    inputMode="decimal"
                    aria-label={`Monto inicial de la casa ${index + 1}`}
                  />
                </label>
                <button
                  type="button"
                  className={btn}
                  disabled={houses.length === 1}
                  onClick={() => setHouses((rows) => rows.filter((row) => row.key !== house.key))}
                  aria-label={`Quitar la casa ${index + 1}`}
                >
                  Quitar
                </button>
              </div>
            ))}
            <button
              type="button"
              className={`${btn} self-start`}
              onClick={() => setHouses((rows) => [...rows, newRow()])}
            >
              <PlusIcon className="h-4 w-4" />
              Añadir casa
            </button>
          </div>
          <div className="rounded-xl bg-violet-50 p-3 text-sm ring-1 ring-violet-200 ring-inset">
            <p className="text-slate-600">
              Banca inicial total: <strong className="text-slate-900">{formatPEN(total)}</strong>
            </p>
            {hasInvalidAmount && (
              <p className="text-xs text-amber-800">
                Hay montos con un formato no válido (usa punto decimal, p. ej. 250.50): no se suman.
              </p>
            )}
          </div>
        </FormStep>

        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={submitting} className={btnPrimary}>
            {submitting ? 'Guardando…' : 'Completar configuración'}
          </button>
          <span className="text-sm text-slate-500">
            Luego podrás añadir casas, depositar o crear nuevas etapas cuando quieras.
          </span>
        </div>
      </form>
    </>
  );
}
