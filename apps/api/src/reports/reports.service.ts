import { Inject, Injectable } from '@nestjs/common';
import {
  addMoney,
  BET_TYPES,
  ErrorCode,
  REPORT_MAX_BETS,
  sumMoney,
  ZERO_MONEY,
  type BetSelectionSummary,
  type DashboardFilters,
  type ReportBet,
  type ReportData,
  type ReportFilters,
  type ReportLeg,
  type ReportPdfQuery,
} from '@letfer/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { ProjectAccess } from '../authorization/authorization.service.js';
import { BetsService } from '../bets/bets.service.js';
import { Clock } from '../common/clock.js';
import { AppError } from '../common/app-error.js';
import { calendarDateInTimeZone } from '../common/timezone.js';
import { DATABASE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { houses, stages, tickets } from '../database/schema/index.js';
import { DashboardService } from '../dashboard/dashboard.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { renderReportPdf, type ReportTicketImage } from './report-pdf.js';

/** Máximo de imágenes de tickets en un PDF (memoria y tamaño del archivo). */
const MAX_TICKET_IMAGES = 60;

/** Legs de una apuesta a partir de sus filas: la cuota del leg, una sola vez (fila `position = 0`). */
export function legsOf(selections: readonly BetSelectionSummary[]): ReportLeg[] {
  const groups = new Map<number, BetSelectionSummary[]>();
  for (const row of selections)
    groups.set(row.eventGroup, [...(groups.get(row.eventGroup) ?? []), row]);
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, rows]) => {
      const ordered = [...rows].sort((a, b) => a.position - b.position);
      const head = ordered[0]!;
      return {
        event: head.event,
        sport: head.sport,
        odds: ordered.find((r) => r.position === 0)?.visibleOdds ?? null,
        conditions: ordered.map((r) => ({ market: r.market, selection: r.selection })),
      };
    });
}

/** Nombre de archivo seguro: solo letras, números, guion y guion bajo. */
export function safeFileName(projectName: string, from: string | null, to: string | null): string {
  const clean = projectName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  const period = from && to ? `_${from}_${to}` : '_historial';
  return `LetFer_Reporte_${clean || 'Proyecto'}${period}.pdf`;
}

/**
 * Reportes e informes PDF (§108.11). SOLO LECTURA: reutiliza el análisis del dashboard (mismas
 * definiciones de P/L, Yield, ROI, win rate y cuota media) y su misma selección de apuestas, con la
 * ganancia de cada una según el ledger. Ninguna cifra financiera se recalcula aquí: solo se suman o
 * ordenan valores ya calculados.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly dashboard: DashboardService,
    private readonly betsService: BetsService,
    private readonly ticketsService: TicketsService,
    private readonly clock: Clock,
  ) {}

  async data(access: ProjectAccess, filters: ReportFilters): Promise<ReportData> {
    const dashboardFilters: DashboardFilters = { ...filters, period: 'month' };
    const [analysis, rows] = await Promise.all([
      this.dashboard.analysis(access, dashboardFilters),
      this.dashboard.reportRows(access, dashboardFilters),
    ]);
    if (rows.length > REPORT_MAX_BETS) {
      throw new AppError(
        413,
        ErrorCode.PAYLOAD_TOO_LARGE,
        `El reporte tendría ${rows.length} apuestas (máximo ${REPORT_MAX_BETS}). Acota el periodo o los filtros.`,
      );
    }

    const types = filters.betType ? [filters.betType] : BET_TYPES;
    const [details, typeAnalyses] = await Promise.all([
      this.betsService.reportDetails(
        access,
        rows.map((r) => r.id),
      ),
      Promise.all(
        types.map((betType) => this.dashboard.analysis(access, { ...dashboardFilters, betType })),
      ),
    ]);

    const bets: ReportBet[] = rows.flatMap((row) => {
      const detail = details.get(row.id);
      if (!detail) return [];
      const { summary, selections } = detail;
      return [
        {
          id: summary.id,
          placedAt: summary.placedAt,
          placedTimeKnown: summary.placedTimeKnown,
          settledAt: summary.settledAt,
          houseName: summary.houseName,
          stageName: summary.stageName,
          betType: summary.betType,
          status: summary.status,
          origin: summary.batchId ? 'IMPORTED' : 'MANUAL',
          stake: summary.stake,
          amount: summary.effectiveAmount,
          visibleTotalOdds: summary.visibleTotalOdds,
          totalOddsSource: summary.totalOddsSource,
          // Del ledger (§112.6): la misma cifra que suma el análisis.
          profitLoss: row.status === 'PENDING' ? null : row.profitLoss,
          provisional: summary.returnSource === 'CALCULATED',
          legs: legsOf(selections),
          ticketCount: summary.ticketCount,
        },
      ];
    });

    const settled = rows
      .filter((r) => r.status !== 'PENDING')
      .sort((a, b) => (a.settledAt?.getTime() ?? 0) - (b.settledAt?.getTime() ?? 0));
    let running = ZERO_MONEY;
    const cumulative = settled.map((row, index) => {
      running = addMoney(running, row.profitLoss);
      return {
        index: index + 1,
        settledAt: (row.settledAt ?? new Date(0)).toISOString(),
        cumulative: running,
      };
    });

    return {
      generatedAt: this.clock.now().toISOString(),
      analysis,
      totals: {
        bets: bets.length,
        stakedSettled: analysis.totalStaked,
        stakedPending: sumMoney(bets.filter((b) => b.status === 'PENDING').map((b) => b.amount)),
        returns: addMoney(analysis.totalStaked, analysis.profitLoss),
        profitLoss: analysis.profitLoss,
      },
      byBetType: types
        .map((betType, i) => {
          const a = typeAnalyses[i]!;
          return { betType, bets: a.counts.total, winRate: a.winRate, roi: a.roi, yield: a.yield };
        })
        .filter((row) => row.bets > 0),
      cumulative,
      bets,
    };
  }

  /** El PDF del reporte: los mismos datos que `data`, con el mismo alcance. */
  async pdf(
    access: ProjectAccess,
    generatedBy: string,
    query: ReportPdfQuery,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const { sections, groupBy, sortBy, direction, orientation, paper, periodLabel, ...filters } =
      query;
    const data = await this.data(access, filters);
    const zone = access.project.timezone;
    const day = (iso: string | undefined) =>
      iso ? calendarDateInTimeZone(new Date(iso), zone) : null;

    // Imágenes de tickets: solo con permiso de tickets y solo JPEG/PNG (un PDF no se incrusta).
    let ticketImages: ReportTicketImage[] | null = null;
    if (sections.includes('tickets')) {
      ticketImages = access.permissions.has('tickets.view')
        ? await this.ticketImages(
            access,
            data.bets.filter((b) => b.ticketCount > 0).map((b) => b.id),
          )
        : null;
    }

    const [houseRow] = filters.houseId
      ? await this.db
          .select({ name: houses.name })
          .from(houses)
          .where(and(eq(houses.id, filters.houseId), eq(houses.projectId, access.project.id)))
      : [];
    const [stageRow] = filters.stageId
      ? await this.db
          .select({ name: stages.name })
          .from(stages)
          .where(and(eq(stages.id, filters.stageId), eq(stages.projectId, access.project.id)))
      : [];

    const buffer = await renderReportPdf({
      data,
      projectName: access.project.name,
      currency: access.project.currency,
      timeZone: zone,
      generatedBy,
      filters,
      filterNames: { house: houseRow?.name, stage: stageRow?.name },
      periodLabel: periodLabel ?? null,
      sections,
      groupBy,
      sortBy,
      direction,
      orientation,
      paper,
      ticketImages,
      ticketsAllowed: access.permissions.has('tickets.view'),
    });
    return {
      buffer,
      fileName: safeFileName(access.project.name, day(filters.from), day(filters.to)),
    };
  }

  private async ticketImages(
    access: ProjectAccess,
    betIds: string[],
  ): Promise<ReportTicketImage[]> {
    if (betIds.length === 0) return [];
    const rows = await this.db
      .select({ id: tickets.id, betId: tickets.betId, mimeType: tickets.mimeType })
      .from(tickets)
      .where(and(eq(tickets.projectId, access.project.id), inArray(tickets.betId, betIds)))
      .orderBy(asc(tickets.createdAt));
    const images: ReportTicketImage[] = [];
    for (const row of rows) {
      if (images.length >= MAX_TICKET_IMAGES) break;
      if (!row.betId) continue;
      if (row.mimeType !== 'image/jpeg' && row.mimeType !== 'image/png') {
        images.push({ betId: row.betId, buffer: null });
        continue;
      }
      const file = await this.ticketsService.getFile(access, row.id);
      images.push({ betId: row.betId, buffer: file.buffer });
    }
    return images;
  }
}
