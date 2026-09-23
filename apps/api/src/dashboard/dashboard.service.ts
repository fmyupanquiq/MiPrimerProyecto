import { Inject, Injectable } from '@nestjs/common';
import {
  addMoney,
  compareMoney,
  isPositiveMoney,
  percentageOf,
  subtractMoney,
  ZERO_MONEY,
  type BankrollChart,
  type BankrollPoint,
  type BetStatusCounts,
  type DashboardAnalysis,
  type DashboardBreakdownItem,
  type DashboardFilters,
  type DashboardHouseBalance,
  type DashboardPeriod,
  type DashboardStatus,
  type MoneyString,
  type PerformanceChart,
  type PerformancePoint,
} from '@letfer/shared';
import { eq, sql, type SQL } from 'drizzle-orm';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import type { DbExecutor } from '../database/database.types.js';
import { houses, stages } from '../database/schema/index.js';
import { computeHouseBalances } from '../finance/balances.js';

/** Formato de `to_char` para agrupar `settled_at` por día/semana ISO/mes (§108.7, D-M7). */
function periodFormat(period: DashboardPeriod): string {
  switch (period) {
    case 'day':
      return 'YYYY-MM-DD';
    case 'week':
      return 'IYYY-"W"IW';
    case 'month':
      return 'YYYY-MM';
  }
}

interface BreakdownRow extends Record<string, unknown> {
  key: string | null;
  profit_loss: MoneyString;
  total_staked: MoneyString;
  count: string;
}

function toBreakdownItem(row: BreakdownRow): DashboardBreakdownItem {
  return {
    key: row.key ?? 'Sin especificar',
    profitLoss: row.profit_loss,
    yield: percentageOf(row.profit_loss, row.total_staked),
    totalStaked: row.total_staked,
    count: Number(row.count),
  };
}

const EMPTY_COUNTS: BetStatusCounts = {
  total: 0,
  pending: 0,
  won: 0,
  lost: 0,
  void: 0,
  cashout: 0,
};

/**
 * Dashboard y métricas (§33, §34, §108, ADR 0015). Todo se calcula en consulta (D-M10): sin
 * tablas de resumen, las cifras se reconstruyen a partir de `bets`, `bet_selections`,
 * `financial_movements`, `stages` y `houses` en cada llamada, igual que `computeHouseBalances`
 * (D3, Fase 3). Las agregaciones (sumas, conteos, curvas y drawdown) se hacen en SQL, no en
 * JavaScript, salvo la combinación final de un puñado de cifras escalares con `@letfer/shared`
 * (el único lugar que hace aritmética de dinero, ADR 0004) — igual que ya hace `toSummary` con
 * los montos de una apuesta.
 */
@Injectable()
export class DashboardService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** `GET /dashboard/status` (§33): foto actual, sin filtros. */
  async status(access: ProjectAccess): Promise<DashboardStatus> {
    const executor = this.db;
    const [balances, houseRows, countRows] = await Promise.all([
      computeHouseBalances(executor, access.project.id),
      executor
        .select({ id: houses.id, name: houses.name })
        .from(houses)
        .where(eq(houses.projectId, access.project.id)),
      executor.execute<{ status: string; total: string }>(
        sql`SELECT status, COUNT(*) AS total FROM bets
            WHERE project_id = ${access.project.id}::uuid AND deleted_at IS NULL
            GROUP BY status`,
      ),
    ]);

    const porCasa: DashboardHouseBalance[] = houseRows.map((house) => {
      const balance = balances.get(house.id);
      return {
        houseId: house.id,
        houseName: house.name,
        balance: balance?.balance ?? ZERO_MONEY,
        committed: balance?.committed ?? ZERO_MONEY,
        available: balance?.available ?? ZERO_MONEY,
      };
    });

    const capitalActual = addMoney(...porCasa.map((h) => h.balance));
    const disponible = addMoney(...porCasa.map((h) => h.available));
    const comprometido = addMoney(...porCasa.map((h) => h.committed));

    return {
      capitalActual,
      disponible,
      comprometido,
      porCasa,
      conteoApuestas: this.countsFromRows(countRows.rows),
    };
  }

  /** `GET /dashboard/analysis` (§33): P/L, Yield, ROI, conteos y desgloses filtrados. */
  async analysis(access: ProjectAccess, filters: DashboardFilters): Promise<DashboardAnalysis> {
    const executor = this.db;
    const projectId = access.project.id;

    const settledWhere = this.filteredBetsCte(access, filters, { settledOnly: true });
    const allWhere = this.filteredBetsCte(access, filters, { settledOnly: false });
    const format = periodFormat(filters.period);

    const [totalsResult, countRows, byHouse, byStage, bySport, byMarket, byPeriod, capital] =
      await Promise.all([
        executor.execute<{ profit_loss: MoneyString; total_staked: MoneyString }>(
          sql`${settledWhere} SELECT
                COALESCE(SUM(profit_loss), 0)::text AS profit_loss,
                COALESCE(SUM(amount), 0)::text AS total_staked
              FROM filtered`,
        ),
        executor.execute<{ status: string; total: string }>(
          sql`${allWhere} SELECT status, COUNT(*) AS total FROM filtered GROUP BY status`,
        ),
        executor.execute<BreakdownRow>(
          sql`${settledWhere} SELECT house_name AS key,
                COALESCE(SUM(profit_loss), 0)::text AS profit_loss,
                COALESCE(SUM(amount), 0)::text AS total_staked,
                COUNT(*)::text AS count
              FROM filtered GROUP BY house_name ORDER BY house_name`,
        ),
        executor.execute<BreakdownRow>(
          sql`${settledWhere} SELECT stage_name AS key,
                COALESCE(SUM(profit_loss), 0)::text AS profit_loss,
                COALESCE(SUM(amount), 0)::text AS total_staked,
                COUNT(*)::text AS count
              FROM filtered GROUP BY stage_name ORDER BY stage_name`,
        ),
        executor.execute<BreakdownRow>(
          sql`${settledWhere} SELECT sport_key AS key,
                COALESCE(SUM(profit_loss), 0)::text AS profit_loss,
                COALESCE(SUM(amount), 0)::text AS total_staked,
                COUNT(*)::text AS count
              FROM filtered GROUP BY sport_key ORDER BY sport_key`,
        ),
        executor.execute<BreakdownRow>(
          sql`${settledWhere} SELECT market_key AS key,
                COALESCE(SUM(profit_loss), 0)::text AS profit_loss,
                COALESCE(SUM(amount), 0)::text AS total_staked,
                COUNT(*)::text AS count
              FROM filtered GROUP BY market_key ORDER BY market_key`,
        ),
        executor.execute<BreakdownRow>(
          sql`${settledWhere} SELECT
                to_char(settled_at AT TIME ZONE ${access.project.timezone}, ${format}) AS key,
                COALESCE(SUM(profit_loss), 0)::text AS profit_loss,
                COALESCE(SUM(amount), 0)::text AS total_staked,
                COUNT(*)::text AS count
              FROM filtered GROUP BY key ORDER BY key`,
        ),
        this.periodCapital(executor, projectId, filters),
      ]);

    const totals = totalsResult.rows[0] ?? { profit_loss: ZERO_MONEY, total_staked: ZERO_MONEY };
    const profitLoss = totals.profit_loss;

    return {
      profitLoss,
      yield: percentageOf(profitLoss, totals.total_staked),
      roi: percentageOf(profitLoss, capital.capitalInvested),
      totalStaked: totals.total_staked,
      capitalInvested: capital.capitalInvested,
      deposits: capital.deposits,
      withdrawals: capital.withdrawals,
      extraordinary: capital.extraordinary,
      counts: this.countsFromRows(countRows.rows),
      byHouse: byHouse.rows.map(toBreakdownItem),
      byStage: byStage.rows.map(toBreakdownItem),
      bySport: bySport.rows.map(toBreakdownItem),
      byMarket: byMarket.rows.map(toBreakdownItem),
      byPeriod: byPeriod.rows.map(toBreakdownItem),
    };
  }

  /** `GET /dashboard/bankroll-chart` (§34, §108.3): evolución de banca real, con todo incluido. */
  async bankrollChart(access: ProjectAccess): Promise<BankrollChart> {
    const executor = this.db;
    const [movementRows, stageRows] = await Promise.all([
      executor.execute<{ occurred_at: string; balance: MoneyString }>(
        sql`SELECT occurred_at,
              SUM(CASE
                    WHEN type = 'TRANSFER' THEN 0
                    WHEN direction = 'DEBIT' THEN -amount
                    ELSE amount
                  END) OVER (ORDER BY occurred_at, id)::text AS balance
            FROM financial_movements
            WHERE project_id = ${access.project.id}::uuid
            ORDER BY occurred_at, id`,
      ),
      executor
        .select({ id: stages.id, name: stages.name, createdAt: stages.createdAt })
        .from(stages)
        .where(eq(stages.projectId, access.project.id))
        .orderBy(stages.createdAt),
    ]);

    const points: BankrollPoint[] = movementRows.rows.map((row) => ({
      occurredAt: new Date(row.occurred_at).toISOString(),
      balance: row.balance,
      stageStarted: null,
    }));
    for (const stage of stageRows) {
      const marker = points.find(
        (p) => new Date(p.occurredAt).getTime() >= stage.createdAt.getTime(),
      );
      if (marker) marker.stageStarted = { id: stage.id, name: stage.name };
    }
    return { points };
  }

  /** `GET /dashboard/performance-chart` (D-M3, D-M6, §108.3-4): curva de rendimiento y drawdown. */
  async performanceChart(access: ProjectAccess): Promise<PerformanceChart> {
    const result = await this.db.execute<{
      occurred_at: string;
      cumulative: MoneyString;
      peak: MoneyString;
    }>(
      sql`WITH curve AS (
            SELECT occurred_at, id,
              SUM(CASE WHEN direction = 'DEBIT' THEN -amount ELSE amount END)
                OVER (ORDER BY occurred_at, id)::text AS cumulative
            FROM financial_movements
            WHERE project_id = ${access.project.id}::uuid
              AND type IN ('BET_PLACEMENT', 'BET_SETTLEMENT')
          )
          SELECT occurred_at, cumulative,
            MAX(cumulative::numeric) OVER (ORDER BY occurred_at, id)::text AS peak
          FROM curve
          ORDER BY occurred_at, id`,
    );

    let maxDrawdown = ZERO_MONEY;
    let maxDrawdownPeak = ZERO_MONEY;
    const points: PerformancePoint[] = result.rows.map((row) => {
      const drawdown = subtractMoney(row.peak, row.cumulative);
      const drawdownPercent = isPositiveMoney(row.peak) ? percentageOf(drawdown, row.peak) : null;
      if (compareMoney(drawdown, maxDrawdown) > 0) {
        maxDrawdown = drawdown;
        maxDrawdownPeak = row.peak;
      }
      return {
        occurredAt: new Date(row.occurred_at).toISOString(),
        cumulativeProfitLoss: row.cumulative,
        drawdown,
        drawdownPercent,
      };
    });

    return {
      points,
      maxDrawdown,
      maxDrawdownPercent: isPositiveMoney(maxDrawdownPeak)
        ? percentageOf(maxDrawdown, maxDrawdownPeak)
        : null,
    };
  }

  // --- Helpers privados --------------------------------------------------------------------

  private countsFromRows(rows: readonly { status: string; total: string }[]): BetStatusCounts {
    const counts = { ...EMPTY_COUNTS };
    for (const row of rows) {
      const total = Number(row.total);
      counts.total += total;
      switch (row.status) {
        case 'PENDING':
          counts.pending = total;
          break;
        case 'WON':
          counts.won = total;
          break;
        case 'LOST':
          counts.lost = total;
          break;
        case 'VOID':
          counts.void = total;
          break;
        case 'CASHOUT':
          counts.cashout = total;
          break;
      }
    }
    return counts;
  }

  /**
   * `banca inicial` (histórica, sin filtro de fecha) + `depósitos netos del periodo filtrado`
   * (§108.1): capital invertido para el ROI. `extraordinary` es neto (crédito - débito) y solo
   * informativo, no forma parte del capital invertido.
   */
  private async periodCapital(
    executor: DbExecutor,
    projectId: string,
    filters: DashboardFilters,
  ): Promise<{
    capitalInvested: MoneyString;
    deposits: MoneyString;
    withdrawals: MoneyString;
    extraordinary: MoneyString;
  }> {
    const houseCondition = filters.houseId ? sql`AND house_id = ${filters.houseId}::uuid` : sql``;
    const dateConditions: SQL[] = [];
    if (filters.from) dateConditions.push(sql`occurred_at >= ${new Date(filters.from)}`);
    if (filters.to) dateConditions.push(sql`occurred_at <= ${new Date(filters.to)}`);
    const dateCondition = dateConditions.length
      ? sql`AND ${sql.join(dateConditions, sql` AND `)}`
      : sql``;

    const [initialResult, periodResult] = await Promise.all([
      executor.execute<{ total: MoneyString }>(
        sql`SELECT COALESCE(SUM(amount), 0)::text AS total FROM financial_movements
            WHERE project_id = ${projectId}::uuid AND type = 'INITIAL_CAPITAL' ${houseCondition}`,
      ),
      executor.execute<{ type: string; direction: string; total: MoneyString }>(
        sql`SELECT type, direction, COALESCE(SUM(amount), 0)::text AS total FROM financial_movements
            WHERE project_id = ${projectId}::uuid
              AND type IN ('DEPOSIT', 'WITHDRAWAL', 'EXTRAORDINARY')
              ${houseCondition} ${dateCondition}
            GROUP BY type, direction`,
      ),
    ]);

    const initialCapital = initialResult.rows[0]?.total ?? ZERO_MONEY;
    let deposits = ZERO_MONEY;
    let withdrawals = ZERO_MONEY;
    let extraordinaryCredit = ZERO_MONEY;
    let extraordinaryDebit = ZERO_MONEY;
    for (const row of periodResult.rows) {
      if (row.type === 'DEPOSIT') deposits = addMoney(deposits, row.total);
      else if (row.type === 'WITHDRAWAL') withdrawals = addMoney(withdrawals, row.total);
      else if (row.type === 'EXTRAORDINARY' && row.direction === 'CREDIT') {
        extraordinaryCredit = addMoney(extraordinaryCredit, row.total);
      } else if (row.type === 'EXTRAORDINARY' && row.direction === 'DEBIT') {
        extraordinaryDebit = addMoney(extraordinaryDebit, row.total);
      }
    }

    return {
      capitalInvested: addMoney(initialCapital, subtractMoney(deposits, withdrawals)),
      deposits,
      withdrawals,
      extraordinary: subtractMoney(extraordinaryCredit, extraordinaryDebit),
    };
  }

  /**
   * CTE `filtered`: apuestas del proyecto según los filtros del §33, con el monto/P·L calculado
   * igual que `BetsService.toSummary` (COALESCE del monto oficial con `stake × unidad`, D-B7) y
   * el "Mixto" de deporte/mercado resuelto por subconsulta (D-M4, §108.5). `settledOnly` excluye
   * `PENDING` (sin P/L todavía) para los indicadores y desgloses financieros; los conteos (§33)
   * usan la variante sin esa restricción para poder mostrar cuántas siguen pendientes.
   *
   * El rango `from`/`to` filtra por `COALESCE(settled_at, placed_at)`: la fecha de liquidación
   * cuando ya se conoce, o la de colocación mientras sigue pendiente (así una apuesta pendiente
   * colocada dentro del rango no desaparece de los conteos solo por no estar liquidada todavía).
   */
  private filteredBetsCte(
    access: ProjectAccess,
    filters: DashboardFilters,
    options: { settledOnly: boolean },
  ): SQL {
    const conditions: SQL[] = [
      sql`b.project_id = ${access.project.id}::uuid`,
      sql`b.deleted_at IS NULL`,
    ];
    if (options.settledOnly) conditions.push(sql`b.status <> 'PENDING'`);
    if (filters.stageId) conditions.push(sql`b.stage_id = ${filters.stageId}::uuid`);
    if (filters.houseId) conditions.push(sql`b.house_id = ${filters.houseId}::uuid`);
    if (filters.betType) conditions.push(sql`b.bet_type = ${filters.betType}::bet_type`);
    if (filters.userId) conditions.push(sql`b.created_by = ${filters.userId}::uuid`);
    if (filters.status) conditions.push(sql`b.status = ${filters.status}::bet_status`);
    if (filters.from) {
      conditions.push(sql`COALESCE(b.settled_at, b.placed_at) >= ${new Date(filters.from)}`);
    }
    if (filters.to) {
      conditions.push(sql`COALESCE(b.settled_at, b.placed_at) <= ${new Date(filters.to)}`);
    }
    if (filters.sport) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM bet_selections bs WHERE bs.bet_id = b.id AND bs.sport = ${filters.sport})`,
      );
    }
    if (filters.market) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM bet_selections bs WHERE bs.bet_id = b.id AND bs.market = ${filters.market})`,
      );
    }

    return sql`WITH filtered AS (
      SELECT
        b.id,
        b.status,
        s.name AS stage_name,
        h.name AS house_name,
        COALESCE(b.official_amount, ROUND(s.unit_stake * b.stake, 2)) AS amount,
        CASE
          WHEN b.status = 'LOST'
            THEN -COALESCE(b.official_amount, ROUND(s.unit_stake * b.stake, 2))
          WHEN b.official_realized_return IS NOT NULL
            THEN b.official_realized_return
                 - COALESCE(b.official_amount, ROUND(s.unit_stake * b.stake, 2))
          ELSE 0
        END AS profit_loss,
        b.settled_at,
        (SELECT CASE WHEN COUNT(DISTINCT bs.sport) = 1 THEN MIN(bs.sport) ELSE 'Mixto' END
           FROM bet_selections bs WHERE bs.bet_id = b.id) AS sport_key,
        (SELECT CASE WHEN COUNT(DISTINCT bs.market) = 1 THEN MIN(bs.market) ELSE 'Mixto' END
           FROM bet_selections bs WHERE bs.bet_id = b.id) AS market_key
      FROM bets b
      JOIN stages s ON s.id = b.stage_id
      JOIN houses h ON h.id = b.house_id
      WHERE ${sql.join(conditions, sql` AND `)}
    ) `;
  }
}
