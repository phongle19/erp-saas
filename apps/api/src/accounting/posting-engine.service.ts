import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { schema } from '@erp/db';
import { money, validateBalanced, type JournalLineInput } from '@erp/domain';
import { currentTx } from '../db/tx-context.js';
import { assertPeriodOpen } from './periods.service.js';

/** All journal amounts are VND (functional currency, minor scale 0) in Phase 1. */
const VND = 'VND';

export interface PostLineInput {
  accountCode: string;
  debitMinor: string | bigint;
  creditMinor: string | bigint;
  memo?: string | undefined;
}

export interface PostInput {
  companyId: string;
  periodId: string;
  entryDate: string;
  description: string;
  lines: PostLineInput[];
}

export interface ReverseOptions {
  periodId?: string | undefined;
  entryDate?: string | undefined;
}

type Entry = typeof schema.journalEntries.$inferSelect;
type Line = typeof schema.journalLines.$inferSelect;

export interface EntryWithLines extends Entry {
  lines: Line[];
}

/** Format a Date as YYYY-MM-DD (local) for the `date` column default. */
function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

@Injectable()
export class PostingEngineService {
  /**
   * The single writer of journal entries + lines. Honors the P4 trigger
   * constraints: post via draft -> lines -> posted within ONE request tx; the
   * app-layer balance gate (validateBalanced) runs ahead of the DB deferred
   * balance trigger (defense in depth).
   */
  async post(input: PostInput): Promise<EntryWithLines> {
    const tx = currentTx();
    const { db } = tx;

    // 1. Access check (mirrors RLS, but fails fast with 403 before any write).
    if (!tx.isAdmin && !tx.accessibleCompanies.includes(input.companyId)) {
      throw new ForbiddenException('no access to company');
    }

    // 2. Period must be open AND belong to input.companyId; read fiscalYear.
    await assertPeriodOpen(input.periodId);
    const periodRows = await db
      .select({
        companyId: schema.accountingPeriods.companyId,
        fiscalYear: schema.accountingPeriods.fiscalYear,
      })
      .from(schema.accountingPeriods)
      .where(eq(schema.accountingPeriods.id, input.periodId))
      .limit(1);
    const period = periodRows[0];
    if (!period || period.companyId !== input.companyId) {
      throw new UnprocessableEntityException(
        'period does not belong to company',
      );
    }
    const fiscalYear = period.fiscalYear;

    // 3. Resolve account codes -> ids (RLS-scoped to the company).
    const codes = input.lines.map((l) => l.accountCode);
    const accounts = await db
      .select({
        id: schema.chartOfAccounts.id,
        code: schema.chartOfAccounts.code,
      })
      .from(schema.chartOfAccounts)
      .where(
        and(
          eq(schema.chartOfAccounts.companyId, input.companyId),
          inArray(schema.chartOfAccounts.code, codes),
        ),
      );
    const codeToId = new Map(accounts.map((a) => [a.code, a.id]));
    for (const code of codes) {
      if (!codeToId.has(code)) {
        throw new UnprocessableEntityException(`unknown account: ${code}`);
      }
    }

    // 4. App-layer balance gate (defense in depth alongside the DB trigger).
    const domainLines: JournalLineInput[] = input.lines.map((l) => ({
      accountCode: l.accountCode,
      debit: money(BigInt(l.debitMinor), VND),
      credit: money(BigInt(l.creditMinor), VND),
      ...(l.memo !== undefined ? { memo: l.memo } : {}),
    }));
    const balanceErr = validateBalanced(domainLines, VND);
    if (balanceErr) {
      throw new UnprocessableEntityException(
        `unbalanced journal: ${balanceErr.code}${balanceErr.detail ? ` (${balanceErr.detail})` : ''}`,
      );
    }

    // 5. entryNo = MAX(entry_no) for (company, fiscalYear) + 1, default 1.
    const maxRows = await db
      .select({ maxNo: sql<number>`COALESCE(MAX(${schema.journalEntries.entryNo}), 0)` })
      .from(schema.journalEntries)
      .where(
        and(
          eq(schema.journalEntries.companyId, input.companyId),
          eq(schema.journalEntries.fiscalYear, fiscalYear),
        ),
      );
    const entryNo = Number(maxRows[0]?.maxNo ?? 0) + 1;

    // 6. INSERT the entry as draft.
    const [entry] = await db
      .insert(schema.journalEntries)
      .values({
        companyId: input.companyId,
        periodId: input.periodId,
        fiscalYear,
        entryNo,
        entryDate: input.entryDate,
        description: input.description,
        status: 'draft',
        createdBy: tx.userId,
      })
      .returning();

    // 7. INSERT lines (entry still draft -> allowed by the immutability trigger).
    const lineValues = input.lines.map((l) => ({
      entryId: entry!.id,
      companyId: input.companyId,
      accountId: codeToId.get(l.accountCode)!,
      debitMinor: BigInt(l.debitMinor),
      creditMinor: BigInt(l.creditMinor),
      ...(l.memo !== undefined ? { lineMemo: l.memo } : {}),
    }));
    const lines = await db
      .insert(schema.journalLines)
      .values(lineValues)
      .returning();

    // 8. UPDATE entry draft -> posted (sets postedAt).
    const [posted] = await db
      .update(schema.journalEntries)
      .set({ status: 'posted', postedAt: new Date() })
      .where(eq(schema.journalEntries.id, entry!.id))
      .returning();

    return { ...posted!, lines };
  }

  /**
   * Reverse a posted entry by creating a new posted entry whose lines are the
   * debit/credit swap, then flipping the original posted -> reversed (status
   * ONLY — every other column unchanged, per the P4 immutability rule).
   */
  async reverse(
    entryId: string,
    opts?: ReverseOptions,
  ): Promise<EntryWithLines> {
    const tx = currentTx();
    const { db } = tx;

    // 1. Load the original (RLS-scoped) + its lines.
    const original = await this.loadEntry(entryId);
    if (original.status !== 'posted') {
      throw new UnprocessableEntityException(
        'only posted entries can be reversed',
      );
    }

    // 2. Target period: opts.periodId ?? original.periodId; must be open.
    const targetPeriodId = opts?.periodId ?? original.periodId;
    await assertPeriodOpen(targetPeriodId);
    const periodRows = await db
      .select({ fiscalYear: schema.accountingPeriods.fiscalYear })
      .from(schema.accountingPeriods)
      .where(eq(schema.accountingPeriods.id, targetPeriodId))
      .limit(1);
    if (!periodRows[0]) {
      throw new UnprocessableEntityException('target period not found');
    }
    const fiscalYear = periodRows[0].fiscalYear;

    // 3. entryNo for (company, targetFiscalYear).
    const maxRows = await db
      .select({ maxNo: sql<number>`COALESCE(MAX(${schema.journalEntries.entryNo}), 0)` })
      .from(schema.journalEntries)
      .where(
        and(
          eq(schema.journalEntries.companyId, original.companyId),
          eq(schema.journalEntries.fiscalYear, fiscalYear),
        ),
      );
    const entryNo = Number(maxRows[0]?.maxNo ?? 0) + 1;

    // 4. INSERT the reversing entry as draft.
    const [entry] = await db
      .insert(schema.journalEntries)
      .values({
        companyId: original.companyId,
        periodId: targetPeriodId,
        fiscalYear,
        entryNo,
        entryDate: opts?.entryDate ?? todayStr(),
        description: `Đảo bút toán #${original.entryNo}`,
        status: 'draft',
        reversesEntryId: original.id,
        createdBy: tx.userId,
      })
      .returning();

    // 5. INSERT swapped lines (keep accountId / companyId; swap debit/credit).
    const lineValues = original.lines.map((l) => ({
      entryId: entry!.id,
      companyId: l.companyId,
      accountId: l.accountId,
      debitMinor: l.creditMinor,
      creditMinor: l.debitMinor,
      ...(l.lineMemo !== null ? { lineMemo: l.lineMemo } : {}),
    }));
    const lines = await db
      .insert(schema.journalLines)
      .values(lineValues)
      .returning();

    // 6. UPDATE the reversing entry draft -> posted.
    const [posted] = await db
      .update(schema.journalEntries)
      .set({ status: 'posted', postedAt: new Date() })
      .where(eq(schema.journalEntries.id, entry!.id))
      .returning();

    // 7. UPDATE the ORIGINAL: status ONLY (every other column unchanged).
    await db
      .update(schema.journalEntries)
      .set({ status: 'reversed' })
      .where(eq(schema.journalEntries.id, original.id));

    return { ...posted!, lines };
  }

  /** RLS-scoped entry + lines, or 404. */
  async get(entryId: string): Promise<EntryWithLines> {
    return this.loadEntry(entryId);
  }

  private async loadEntry(entryId: string): Promise<EntryWithLines> {
    const { db } = currentTx();
    const rows = await db
      .select()
      .from(schema.journalEntries)
      .where(eq(schema.journalEntries.id, entryId))
      .limit(1);
    const entry = rows[0];
    if (!entry) throw new NotFoundException('journal entry not found');

    const lines = await db
      .select()
      .from(schema.journalLines)
      .where(eq(schema.journalLines.entryId, entryId))
      .orderBy(schema.journalLines.id);

    return { ...entry, lines };
  }
}
