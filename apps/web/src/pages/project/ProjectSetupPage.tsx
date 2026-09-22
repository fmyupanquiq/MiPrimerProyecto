import { projectSetupSchema, type ProjectSetupInput } from '@letfer/shared';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { describeApiError } from '../../api/errors.js';
import { projectSetupApi } from '../../api/finance.js';
import { btn, btnPrimary, inputClass, Notice, Section } from '../../ui.js';
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

  const total = houses.reduce((sum, house) => sum + (Number(house.initialAmount) || 0), 0);

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
    <Section title="Configuración inicial">
      <p className="text-sm text-slate-600">
        Se creará la Etapa 1 con esta unidad, se darán de alta las casas y se registrará la banca
        inicial como capital del proyecto. La moneda es PEN y no se puede cambiar.
      </p>
      <form
        onSubmit={(event) => void onSubmit(event)}
        className="flex flex-col gap-4"
        aria-label="Configuración inicial"
        noValidate
      >
        <div className="flex max-w-xs flex-col gap-1">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Unidad de stake de la Etapa 1
            <input
              value={unitStake}
              onChange={(event) => setUnitStake(event.target.value)}
              className={inputClass}
              placeholder="10.00"
              aria-describedby="unit-stake-help"
            />
          </label>
          <span id="unit-stake-help" className="text-xs text-slate-500">
            Monto teórico de una apuesta = stake × unidad. Ejemplo: unidad 10, stake 1.5 → 15.
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Casas y banca inicial</h3>
          {houses.map((house, index) => (
            <div key={house.key} className="flex flex-wrap items-end gap-2">
              <label className="flex flex-1 flex-col gap-1 text-sm">
                {index === 0 ? 'Nombre' : ''}
                <input
                  value={house.name}
                  onChange={(event) => updateHouse(house.key, { name: event.target.value })}
                  className={inputClass}
                  placeholder="Betano"
                  aria-label={`Nombre de la casa ${index + 1}`}
                />
              </label>
              <label className="flex w-40 flex-col gap-1 text-sm">
                {index === 0 ? 'Monto inicial' : ''}
                <input
                  value={house.initialAmount}
                  onChange={(event) =>
                    updateHouse(house.key, { initialAmount: event.target.value })
                  }
                  className={inputClass}
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
            Añadir casa
          </button>
          <p className="text-sm text-slate-600">
            Banca inicial total: <strong>S/ {total.toFixed(2)}</strong>
          </p>
        </div>

        {error && <Notice tone="error">{error}</Notice>}
        <button type="submit" disabled={submitting} className={`${btnPrimary} self-start`}>
          {submitting ? 'Guardando…' : 'Completar configuración'}
        </button>
      </form>
    </Section>
  );
}
