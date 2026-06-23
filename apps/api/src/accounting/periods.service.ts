import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { schema } from '@erp/db';
import { currentTx } from '../db/tx-context.js';

export type Period = typeof schema.accountingPeriods.$inferSelect;

export interface SpecialPeriodSpec {
  periodNo: number;
  purpose: string;
  nameVi: string;
}

/**
 * Throw a 422 if the period is not 'open'.
 * Imported by the Phase 6 posting engine to gate journal postings.
 */
export async function assertPeriodOpen(periodId: string): Promise<void> {
  const rows = await currentTx()
    .db.select({ status: schema.accountingPeriods.status })
    .from(schema.accountingPeriods)
    .where(eq(schema.accountingPeriods.id, periodId))
    .limit(1);

  if (!rows[0]) {
    throw new UnprocessableEntityException('period not found');
  }
  if (rows[0].status !== 'open') {
    throw new UnprocessableEntityException(
      `period is not open (status: ${rows[0].status})`,
    );
  }
}

/**
 * Return the last day of a given calendar month.
 * Uses the "first day of next month minus 1 day" trick to handle
 * 28/29/30/31-day months correctly (including Feb in leap years).
 */
function lastDayOfMonth(year: number, month: number): string {
  // month is 1-based; Date uses 0-based months
  const d = new Date(year, month, 0); // day 0 of next month = last day of this month
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Format a date as YYYY-MM-DD from year, 1-based month, and day. */
function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

@Injectable()
export class PeriodsService {
  /**
   * Generate 12 regular periods + optional special periods for a fiscal year.
   *
   * Period 1 starts on <fiscalYear>-<fiscalYearStartMonth>-01.
   * Each subsequent regular period is the next calendar month; months that
   * roll past December continue into <fiscalYear+1>.
   *
   * Special periods: startDate/endDate are null in Phase 1 (no natural dates for
   * closing/audit/retrospective adjustments; post-close timing varies per company).
   *
   * Idempotent on (companyId, fiscalYear, periodNo): existing periods are skipped.
   */
  async generateFiscalYear(
    companyId: string,
    fiscalYear: number,
    opts?: { specialPeriods?: SpecialPeriodSpec[] },
  ): Promise<{ created: number }> {
    const db = currentTx().db;

    // Resolve the company's fiscalYearStartMonth (RLS-scoped).
    const companies = await db
      .select({ fiscalYearStartMonth: schema.companies.fiscalYearStartMonth })
      .from(schema.companies)
      .where(eq(schema.companies.id, companyId))
      .limit(1);

    if (!companies[0]) throw new NotFoundException('company not found');
    const startMonth: number = companies[0].fiscalYearStartMonth ?? 1;

    // Find existing (periodNo)s for this company+fiscalYear to ensure idempotency.
    const existingPeriods = await db
      .select({ periodNo: schema.accountingPeriods.periodNo })
      .from(schema.accountingPeriods)
      .where(
        and(
          eq(schema.accountingPeriods.companyId, companyId),
          eq(schema.accountingPeriods.fiscalYear, fiscalYear),
        ),
      );

    const existingNos = new Set(existingPeriods.map((r) => r.periodNo));

    // Build 12 regular periods.
    type InsertRow = typeof schema.accountingPeriods.$inferInsert;
    const toInsert: InsertRow[] = [];

    for (let i = 0; i < 12; i++) {
      const periodNo = i + 1;
      if (existingNos.has(periodNo)) continue;

      // Calendar month and year, rolling over December → January of next year.
      const totalMonths = startMonth - 1 + i; // 0-indexed offset from Jan of fiscalYear
      const calYear = fiscalYear + Math.floor(totalMonths / 12);
      const calMonth = (totalMonths % 12) + 1; // 1-based

      const startDate = toDateStr(calYear, calMonth, 1);
      const endDate = lastDayOfMonth(calYear, calMonth);
      const nameVi = `Tháng ${calMonth}/${calYear}`;

      toInsert.push({
        companyId,
        fiscalYear,
        periodNo,
        periodType: 'regular',
        nameVi,
        startDate,
        endDate,
        status: 'open',
      });
    }

    // Build special periods.
    const specials = opts?.specialPeriods ?? [];
    for (const spec of specials) {
      if (existingNos.has(spec.periodNo)) continue;

      toInsert.push({
        companyId,
        fiscalYear,
        periodNo: spec.periodNo,
        periodType: 'special',
        purpose: spec.purpose,
        nameVi: spec.nameVi,
        // startDate/endDate are null for special periods in Phase 1.
        // Post-close timing varies per company; dates can be added in a later phase.
        startDate: null,
        endDate: null,
        status: 'open',
      });
    }

    if (toInsert.length === 0) return { created: 0 };

    await db.insert(schema.accountingPeriods).values(toInsert);
    return { created: toInsert.length };
  }

  /** RLS-scoped list of periods for a company and fiscal year, ordered by periodNo. */
  async list(companyId: string, fiscalYear: number): Promise<Period[]> {
    return currentTx()
      .db.select()
      .from(schema.accountingPeriods)
      .where(
        and(
          eq(schema.accountingPeriods.companyId, companyId),
          eq(schema.accountingPeriods.fiscalYear, fiscalYear),
        ),
      )
      .orderBy(schema.accountingPeriods.periodNo);
  }

  /** Get a single period by ID (RLS-scoped via companyId join). */
  async getById(periodId: string): Promise<Period> {
    const rows = await currentTx()
      .db.select()
      .from(schema.accountingPeriods)
      .where(eq(schema.accountingPeriods.id, periodId))
      .limit(1);

    if (!rows[0]) throw new NotFoundException('period not found');
    return rows[0];
  }

  /**
   * Transition: open → closed.
   * Sets closedAt + closedBy from the current user context.
   */
  async close(periodId: string): Promise<Period> {
    const db = currentTx().db;
    const { userId } = currentTx();

    const period = await this.getById(periodId);
    if (period.status !== 'open') {
      throw new UnprocessableEntityException(
        `cannot close period with status: ${period.status}`,
      );
    }

    const [updated] = await db
      .update(schema.accountingPeriods)
      .set({
        status: 'closed',
        closedAt: new Date(),
        closedBy: userId ?? null,
      })
      .where(eq(schema.accountingPeriods.id, periodId))
      .returning();

    return updated!;
  }

  /**
   * Transition: closed → open.
   * Locked periods cannot be reopened (locked is terminal).
   */
  async reopen(periodId: string): Promise<Period> {
    const db = currentTx().db;

    const period = await this.getById(periodId);
    if (period.status === 'locked') {
      throw new ForbiddenException('locked periods cannot be reopened');
    }
    if (period.status !== 'closed') {
      throw new UnprocessableEntityException(
        `cannot reopen period with status: ${period.status}`,
      );
    }

    const [updated] = await db
      .update(schema.accountingPeriods)
      .set({ status: 'open', closedAt: null, closedBy: null })
      .where(eq(schema.accountingPeriods.id, periodId))
      .returning();

    return updated!;
  }

  /**
   * Transition: → locked (terminal, from any non-locked status).
   * Once locked, the period cannot be reopened.
   */
  async lock(periodId: string): Promise<Period> {
    const db = currentTx().db;

    const period = await this.getById(periodId);
    if (period.status === 'locked') {
      throw new UnprocessableEntityException('period is already locked');
    }

    const [updated] = await db
      .update(schema.accountingPeriods)
      .set({ status: 'locked' })
      .where(eq(schema.accountingPeriods.id, periodId))
      .returning();

    return updated!;
  }
}
