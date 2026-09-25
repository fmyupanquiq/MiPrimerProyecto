import { formatPEN } from '@letfer/shared';
import { Link } from 'react-router';
import { betsApi } from '../../api/bets.js';
import { useLoad } from '../../hooks/useLoad.js';
import { BET_TYPE_LABELS, formatDateTime } from '../../labels.js';
import { Notice, Section } from '../../ui.js';
import { useProject } from './ProjectContext.js';

const deltaClass = (value: string) => (value.startsWith('-') ? 'text-red-700' : 'text-green-700');

/**
 * Retornos calculados y oficiales (§77, §112.2): las ganadas que siguen con retorno provisional y la
 * comparación de calculado y oficial. Es solo lectura: la confirmación se hace en la apuesta. La
 * comparación reúne la evidencia para decidir el redondeo (D-B8); no decide nada ni cambia datos.
 */
export function ReturnsPage() {
  const { project } = useProject();
  const pending = useLoad(`unconfirmed-returns:${project.id}`, () =>
    betsApi.unconfirmedReturns(project.id),
  );
  const differences = useLoad(`return-differences:${project.id}`, () =>
    betsApi.returnDifferences(project.id),
  );

  return (
    <>
      <Section title="Retornos por confirmar">
        <p className="text-sm text-slate-600">
          Ganadas liquidadas con un retorno <strong>calculado</strong> (monto × cuota visible). Ya
          cuentan en la ganancia, el Yield y el ROI, pero son provisionales hasta confirmar el
          retorno oficial de la casa desde{' '}
          <Link to={`/projects/${project.id}/bets`} className="underline">
            Apuestas
          </Link>
          .
        </p>
        {pending.error && <Notice tone="error">{pending.error}</Notice>}
        {pending.loading && !pending.data && <p>Cargando…</p>}
        {pending.data && pending.data.length === 0 && (
          <Notice tone="success">No hay retornos pendientes de confirmar.</Notice>
        )}
        {pending.data && pending.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" aria-label="Retornos por confirmar">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="py-1 pr-3 font-medium">Liquidada</th>
                  <th className="py-1 pr-3 font-medium">Casa</th>
                  <th className="py-1 pr-3 font-medium">Etapa</th>
                  <th className="py-1 pr-3 font-medium">Monto</th>
                  <th className="py-1 pr-3 font-medium">Retorno calculado</th>
                  <th className="py-1 font-medium">Ganancia provisional</th>
                </tr>
              </thead>
              <tbody>
                {pending.data.map((item) => (
                  <tr key={item.betId} className="border-b border-slate-100">
                    <td className="py-1 pr-3">{formatDateTime(item.settledAt)}</td>
                    <td className="py-1 pr-3">{item.houseName}</td>
                    <td className="py-1 pr-3">{item.stageName}</td>
                    <td className="py-1 pr-3">{formatPEN(item.effectiveAmount)}</td>
                    <td className="py-1 pr-3">{formatPEN(item.calculatedRealizedReturn)}</td>
                    <td className={`py-1 ${deltaClass(item.provisionalProfit)}`}>
                      {formatPEN(item.provisionalProfit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Diferencias entre retorno calculado y oficial">
        <p className="text-sm text-slate-600">
          Compara, en las ganadas que tienen ambos, el retorno calculado con el que informó la casa.
          Sirve de evidencia para decidir la política de redondeo (pendiente de confirmar con
          tickets reales); esta pantalla no cambia ningún dato.
        </p>
        {differences.error && <Notice tone="error">{differences.error}</Notice>}
        {differences.loading && !differences.data && <p>Cargando…</p>}
        {differences.data && differences.data.compared === 0 && (
          <Notice tone="info">Todavía no hay ganadas con retorno calculado y oficial.</Notice>
        )}
        {differences.data && differences.data.compared > 0 && (
          <>
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-slate-600">Ganadas comparadas</dt>
                <dd className="text-lg font-medium">{differences.data.compared}</dd>
              </div>
              <div>
                <dt className="text-slate-600">Con diferencia</dt>
                <dd className="text-lg font-medium">{differences.data.differing}</dd>
              </div>
              <div>
                <dt className="text-slate-600">Diferencia total (oficial − calculado)</dt>
                <dd className={`text-lg font-medium ${deltaClass(differences.data.totalDelta)}`}>
                  {formatPEN(differences.data.totalDelta)}
                </dd>
              </div>
            </dl>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm" aria-label="Diferencias por casa">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-600">
                    <th className="py-1 pr-3 font-medium">Casa</th>
                    <th className="py-1 pr-3 font-medium">Comparadas</th>
                    <th className="py-1 pr-3 font-medium">Con diferencia</th>
                    <th className="py-1 font-medium">Diferencia total</th>
                  </tr>
                </thead>
                <tbody>
                  {differences.data.byHouse.map((house) => (
                    <tr key={house.houseId} className="border-b border-slate-100">
                      <td className="py-1 pr-3">{house.houseName}</td>
                      <td className="py-1 pr-3">{house.compared}</td>
                      <td className="py-1 pr-3">{house.differing}</td>
                      <td className={`py-1 ${deltaClass(house.totalDelta)}`}>
                        {formatPEN(house.totalDelta)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {differences.data.items.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm" aria-label="Apuestas con diferencia">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-600">
                      <th className="py-1 pr-3 font-medium">Liquidada</th>
                      <th className="py-1 pr-3 font-medium">Casa</th>
                      <th className="py-1 pr-3 font-medium">Tipo</th>
                      <th className="py-1 pr-3 font-medium">Monto</th>
                      <th className="py-1 pr-3 font-medium">Cuota</th>
                      <th className="py-1 pr-3 font-medium">Calculado</th>
                      <th className="py-1 pr-3 font-medium">Oficial</th>
                      <th className="py-1 font-medium">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {differences.data.items.map((item) => (
                      <tr key={item.betId} className="border-b border-slate-100">
                        <td className="py-1 pr-3">{formatDateTime(item.settledAt)}</td>
                        <td className="py-1 pr-3">{item.houseName}</td>
                        <td className="py-1 pr-3">{BET_TYPE_LABELS[item.betType]}</td>
                        <td className="py-1 pr-3">{formatPEN(item.effectiveAmount)}</td>
                        <td className="py-1 pr-3">{item.visibleTotalOdds}</td>
                        <td className="py-1 pr-3">{formatPEN(item.calculatedRealizedReturn)}</td>
                        <td className="py-1 pr-3">{formatPEN(item.officialRealizedReturn)}</td>
                        <td className={`py-1 ${deltaClass(item.delta)}`}>
                          {formatPEN(item.delta)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Section>
    </>
  );
}
