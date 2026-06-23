import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, and, lte, ne, asc, sql } from 'drizzle-orm';
import { schema } from '@erp/db';
import { currentTx } from '../db/tx-context.js';

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  /** Total debit-side movements, bigint string. */
  debit: string;
  /** Total credit-side movements, bigint string. */
  credit: string;
  /** debit − credit per account, bigint string (can be negative for credit-normal accounts). */
  balance: string;
}

export interface TrialBalance {
  fiscalYear: number;
  throughPeriodNo: number;
  rows: TrialBalanceRow[];
  totals: {
    /** Sum of all debit movements — must equal totals.credit for a balanced set. */
    debit: string;
    /** Sum of all credit movements — must equal totals.debit for a balanced set. */
    credit: string;
  };
}

export interface LedgerMovement {
  entryNo: number;
  entryDate: string;
  description: string;
  debit: string;
  credit: string;
  runningBalance: string;
}

export interface GeneralLedger {
  accountCode: string;
  name: string;
  /**
   * Phase 1: no prior-year carryforward — opening balance is always 0.
   * A full opening-balance engine (prior-year P&L close to equity, balance-sheet
   * carry) is deferred to Phase 3.
   */
  openingBalance: string;
  movements: LedgerMovement[];
  closingBalance: string;
}

@Injectable()
export class LedgerService {
  /**
   * Trial balance: sums debit_minor and credit_minor per account for all
   * non-draft journal entries whose period falls within the given fiscal year
   * and has periodNo <= throughPeriodNo.
   *
   * Accounting semantics — status filter is `status <> 'draft'` (NOT `= 'posted'`).
   * Reason: when entry A is reversed, A's status becomes 'reversed' and the
   * reversing entry B gets status 'posted'. A's lines remain in the ledger and
   * B's lines cancel them out. If we filtered to only 'posted', we would exclude
   * A and include only B — corrupting the books. Both A and B must appear so that
   * they net to zero in the affected accounts.
   *
   * Cumulative through-period: aggregating over periodNo <= throughPeriodNo
   * allows callers to get mid-year views (through=12 excludes special adjustment
   * periods ≥ 13) or post-adjustment views (through=15 includes them).
   */
  async trialBalance(
    companyId: string,
    fiscalYear: number,
    throughPeriodNo: number,
  ): Promise<TrialBalance> {
    const { db } = currentTx();

    // Single SQL query: join journal_lines -> journal_entries -> accounting_periods,
    // filter non-draft status + fiscalYear + periodNo <= through, group by account.
    // Also join chart_of_accounts for code/name. RLS on each table scopes to companyId.
    const rows = await db
      .select({
        accountId: schema.chartOfAccounts.id,
        code: schema.chartOfAccounts.code,
        name: schema.chartOfAccounts.name,
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
      .innerJoin(
        schema.chartOfAccounts,
        eq(schema.journalLines.accountId, schema.chartOfAccounts.id),
      )
      .where(
        and(
          eq(schema.journalLines.companyId, companyId),
          ne(schema.journalEntries.status, 'draft'),
          eq(schema.journalEntries.fiscalYear, fiscalYear),
          lte(schema.accountingPeriods.periodNo, throughPeriodNo),
        ),
      )
      .groupBy(
        schema.chartOfAccounts.id,
        schema.chartOfAccounts.code,
        schema.chartOfAccounts.name,
      )
      .orderBy(asc(schema.chartOfAccounts.code));

    // Compute balance and totals in JS with bigint to stay exact (no float).
    let totalDebit = 0n;
    let totalCredit = 0n;

    const tbRows: TrialBalanceRow[] = rows.map((r) => {
      const debit = BigInt(r.debit);
      const credit = BigInt(r.credit);
      totalDebit += debit;
      totalCredit += credit;
      return {
        accountId: r.accountId,
        code: r.code,
        name: r.name,
        debit: debit.toString(),
        credit: credit.toString(),
        balance: (debit - credit).toString(),
      };
    });

    return {
      fiscalYear,
      throughPeriodNo,
      rows: tbRows,
      totals: {
        debit: totalDebit.toString(),
        credit: totalCredit.toString(),
      },
    };
  }

  /**
   * General ledger for a single account: all non-draft movements in the given
   * fiscal year up to throughPeriodNo, in chronological order (entryDate, entryNo).
   * Running balance is computed in JS starting from openingBalance = 0.
   *
   * Phase 1 note: openingBalance is always '0' — prior-year equity close and
   * balance-sheet carryforward are deferred to Phase 3.
   */
  async generalLedger(
    companyId: string,
    accountCode: string,
    fiscalYear: number,
    throughPeriodNo: number,
  ): Promise<GeneralLedger> {
    const { db } = currentTx();

    // 1. Resolve account (RLS-scoped via companyId filter; 404 if not found).
    const acctRows = await db
      .select({
        id: schema.chartOfAccounts.id,
        name: schema.chartOfAccounts.name,
      })
      .from(schema.chartOfAccounts)
      .where(
        and(
          eq(schema.chartOfAccounts.companyId, companyId),
          eq(schema.chartOfAccounts.code, accountCode),
        ),
      )
      .limit(1);

    const account = acctRows[0];
    if (!account) {
      throw new NotFoundException(
        `account code '${accountCode}' not found for this company`,
      );
    }

    // 2. Fetch movements: journal_lines for this account in non-draft entries
    //    whose period has periodNo <= throughPeriodNo and fiscalYear matches.
    //    Order by entryDate ASC then entryNo ASC (chronological ledger order).
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
          eq(schema.journalLines.accountId, account.id),
          eq(schema.journalLines.companyId, companyId),
          ne(schema.journalEntries.status, 'draft'),
          eq(schema.journalEntries.fiscalYear, fiscalYear),
          lte(schema.accountingPeriods.periodNo, throughPeriodNo),
        ),
      )
      .orderBy(
        asc(schema.journalEntries.entryDate),
        asc(schema.journalEntries.entryNo),
      );

    // 3. Compute running balance in JS using bigint arithmetic.
    let runningBalance = 0n;
    const ledgerMovements: LedgerMovement[] = movements.map((m) => {
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
      accountCode,
      name: account.name,
      openingBalance: '0',
      movements: ledgerMovements,
      closingBalance: runningBalance.toString(),
    };
  }
}
