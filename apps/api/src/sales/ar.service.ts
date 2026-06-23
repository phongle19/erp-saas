import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, and, lte, ne, asc, isNull, sql } from 'drizzle-orm';
import { schema } from '@erp/db';
import { currentTx } from '../db/tx-context.js';

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface ArCustomerRow {
  /** null means "unidentified partner" (NULL partnerId on the line). */
  partnerId: string | null;
  partnerCode: string | null;
  partnerName: string | null;
  /** Total debit movements on account 131 for this partner, bigint string. */
  debit: string;
  /** Total credit movements on account 131 for this partner, bigint string. */
  credit: string;
  /** debit − credit = open receivable (positive = owed to us), bigint string. */
  balance: string;
}

export interface ArByCustomer {
  fiscalYear: number;
  throughPeriodNo: number;
  rows: ArCustomerRow[];
  /** Sum of all customer balances. Must equal the trial-balance 131 balance. */
  total: string;
}

export interface ArMovement {
  entryNo: number;
  entryDate: string;
  description: string;
  debit: string;
  credit: string;
  runningBalance: string;
}

export interface ArForCustomer {
  partner: {
    id: string;
    code: string;
    name: string;
  };
  /**
   * Phase 1/2a note: no prior-year carryforward — opening balance is always '0'.
   * A full opening-balance engine (prior-year balance-sheet carry) is deferred to Phase 3.
   */
  openingBalance: string;
  movements: ArMovement[];
  closingBalance: string;
}

@Injectable()
export class ArService {
  /**
   * AR sub-ledger grouped by customer (partner).
   *
   * Aggregates journal_lines on the company's account 131 (Phải thu khách hàng)
   * for all non-draft entries whose period falls within the given fiscal year and
   * has periodNo <= throughPeriodNo. Groups by partnerId, joining business_partners
   * for code/name. Lines with NULL partnerId (defensive — shouldn't arise from sales
   * docs) are grouped under a null/"(không xác định)" bucket so the total still
   * reconciles to the trial-balance 131 balance.
   *
   * Status semantics: `status <> 'draft'` (same as the Trial Balance / LedgerService).
   * A reversed entry's lines remain visible and the reversing entry nets them back to
   * zero. Excluding 'reversed' would break reconciliation.
   *
   * The returned `total` (Σ balance) MUST equal the 131 row in the trial balance.
   */
  async arByCustomer(
    companyId: string,
    fiscalYear: number,
    throughPeriodNo: number,
  ): Promise<ArByCustomer> {
    const { db } = currentTx();

    // Resolve the 131 account for this company (RLS-scoped).
    const acct131 = await this.resolve131(companyId);

    // Query: group journal_lines on 131 by partnerId, join business_partners for code/name.
    // NULL partnerId is preserved as a separate group via LEFT JOIN + CASE.
    // We use a raw SQL aggregation approach mirroring LedgerService.trialBalance.
    const rows = await db
      .select({
        partnerId: schema.journalLines.partnerId,
        partnerCode: schema.businessPartners.code,
        partnerName: schema.businessPartners.name,
        debit: sql<string>`COALESCE(SUM(${schema.journalLines.debitMinor}), 0)::text`,
        credit: sql<string>`COALESCE(SUM(${schema.journalLines.creditMinor}), 0)::text`,
      })
      .from(schema.journalLines)
      .innerJoin(
        schema.journalEntries,
        eq(schema.journalLines.entryId, schema.journalEntries.id),
      )
      .innerJoin(
        schema.accountingPeriods,
        eq(schema.journalEntries.periodId, schema.accountingPeriods.id),
      )
      .leftJoin(
        schema.businessPartners,
        eq(schema.journalLines.partnerId, schema.businessPartners.id),
      )
      .where(
        and(
          eq(schema.journalLines.companyId, companyId),
          eq(schema.journalLines.accountId, acct131),
          ne(schema.journalEntries.status, 'draft'),
          eq(schema.journalEntries.fiscalYear, fiscalYear),
          lte(schema.accountingPeriods.periodNo, throughPeriodNo),
        ),
      )
      .groupBy(
        schema.journalLines.partnerId,
        schema.businessPartners.code,
        schema.businessPartners.name,
      )
      .orderBy(asc(schema.businessPartners.code));

    // Compute balance per customer in JS with bigint (no float).
    let totalBalance = 0n;
    const arRows: ArCustomerRow[] = rows.map((r) => {
      const debit = BigInt(r.debit);
      const credit = BigInt(r.credit);
      const balance = debit - credit;
      totalBalance += balance;
      return {
        partnerId: r.partnerId ?? null,
        partnerCode: r.partnerCode ?? null,
        partnerName: r.partnerName ?? '(không xác định)',
        debit: debit.toString(),
        credit: credit.toString(),
        balance: balance.toString(),
      };
    });

    return {
      fiscalYear,
      throughPeriodNo,
      rows: arRows,
      total: totalBalance.toString(),
    };
  }

  /**
   * AR ledger for a single customer: all non-draft movements on account 131 for
   * the given partner, in chronological order, with a running balance.
   *
   * Returns 404 if the partner is not accessible for this company.
   */
  async arForCustomer(
    companyId: string,
    partnerId: string,
    fiscalYear: number,
    throughPeriodNo: number,
  ): Promise<ArForCustomer> {
    const { db } = currentTx();

    // 1. Verify the partner belongs to this company (RLS-scoped; 404 if not found/hidden).
    const partnerRows = await db
      .select({
        id: schema.businessPartners.id,
        code: schema.businessPartners.code,
        name: schema.businessPartners.name,
      })
      .from(schema.businessPartners)
      .where(
        and(
          eq(schema.businessPartners.id, partnerId),
          eq(schema.businessPartners.companyId, companyId),
        ),
      )
      .limit(1);

    const partner = partnerRows[0];
    if (!partner) {
      throw new NotFoundException('partner not found for this company');
    }

    // 2. Resolve the 131 account for this company.
    const acct131 = await this.resolve131(companyId);

    // 3. Fetch movements on 131 for this partner in non-draft entries,
    //    ordered chronologically (entryDate ASC, entryNo ASC).
    const movements = await db
      .select({
        entryNo: schema.journalEntries.entryNo,
        entryDate: schema.journalEntries.entryDate,
        description: schema.journalEntries.description,
        debit: schema.journalLines.debitMinor,
        credit: schema.journalLines.creditMinor,
      })
      .from(schema.journalLines)
      .innerJoin(
        schema.journalEntries,
        eq(schema.journalLines.entryId, schema.journalEntries.id),
      )
      .innerJoin(
        schema.accountingPeriods,
        eq(schema.journalEntries.periodId, schema.accountingPeriods.id),
      )
      .where(
        and(
          eq(schema.journalLines.companyId, companyId),
          eq(schema.journalLines.accountId, acct131),
          eq(schema.journalLines.partnerId, partnerId),
          ne(schema.journalEntries.status, 'draft'),
          eq(schema.journalEntries.fiscalYear, fiscalYear),
          lte(schema.accountingPeriods.periodNo, throughPeriodNo),
        ),
      )
      .orderBy(
        asc(schema.journalEntries.entryDate),
        asc(schema.journalEntries.entryNo),
      );

    // 4. Compute running balance in JS with bigint.
    let runningBalance = 0n;
    const arMovements: ArMovement[] = movements.map((m) => {
      const debit = BigInt(m.debit);
      const credit = BigInt(m.credit);
      runningBalance += debit - credit;
      return {
        entryNo: m.entryNo,
        entryDate: m.entryDate,
        description: m.description,
        debit: debit.toString(),
        credit: credit.toString(),
        runningBalance: runningBalance.toString(),
      };
    });

    return {
      partner: {
        id: partner.id,
        code: partner.code,
        name: partner.name,
      },
      openingBalance: '0',
      movements: arMovements,
      closingBalance: runningBalance.toString(),
    };
  }

  /**
   * Resolve the chart_of_accounts row for account code '131' scoped to companyId.
   * Throws NotFoundException if not provisioned (shouldn't happen for a normal SME).
   */
  private async resolve131(companyId: string): Promise<string> {
    const { db } = currentTx();
    const rows = await db
      .select({ id: schema.chartOfAccounts.id })
      .from(schema.chartOfAccounts)
      .where(
        and(
          eq(schema.chartOfAccounts.companyId, companyId),
          eq(schema.chartOfAccounts.code, '131'),
        ),
      )
      .limit(1);

    if (!rows[0]) {
      throw new NotFoundException(
        `account 131 not provisioned for this company`,
      );
    }
    return rows[0].id;
  }
}
