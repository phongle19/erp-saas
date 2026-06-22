import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@erp/db';
import { getChartOfAccounts, type AccountSeed } from '@erp/config-regimes';
import { currentTx } from '../db/tx-context.js';

export type Account = typeof schema.chartOfAccounts.$inferSelect;

@Injectable()
export class CoaService {
  /**
   * Provision the chart of accounts for a company from its regime config.
   * Idempotent: codes already present for the company are skipped.
   *
   * Note: AccountSeed.parentCode is intentionally not persisted in Phase 1.
   * chart_of_accounts has no parent column — the account code prefix encodes
   * hierarchy (e.g., 111x is a child of 111, which is a child of 1xx).
   */
  async provision(companyId: string): Promise<{ inserted: number }> {
    const db = currentTx().db;

    // Load the company to get its regime (RLS-scoped).
    const companies = await db
      .select({ regime: schema.companies.regime })
      .from(schema.companies)
      .where(eq(schema.companies.id, companyId))
      .limit(1);

    if (!companies[0]) throw new NotFoundException('company not found');
    const { regime } = companies[0];

    const seeds = getChartOfAccounts(regime);
    if (seeds.length === 0) return { inserted: 0 };

    // Find codes already present for this company (idempotency).
    const existingRows = await db
      .select({ code: schema.chartOfAccounts.code })
      .from(schema.chartOfAccounts)
      .where(eq(schema.chartOfAccounts.companyId, companyId));

    const existingCodes = new Set(existingRows.map((r) => r.code));

    const toInsert = seeds
      .filter((s: AccountSeed) => !existingCodes.has(s.code))
      .map((s: AccountSeed) => ({
        companyId,
        code: s.code,
        name: s.name,
        // parentCode is intentionally not persisted in Phase 1 (no parent column).
        type: s.type as typeof schema.chartOfAccounts.$inferInsert['type'],
      }));

    if (toInsert.length === 0) return { inserted: 0 };

    await db.insert(schema.chartOfAccounts).values(toInsert);
    return { inserted: toInsert.length };
  }

  /** RLS-scoped list of all accounts for a company, ordered by code. */
  async list(companyId: string): Promise<Account[]> {
    return currentTx()
      .db.select()
      .from(schema.chartOfAccounts)
      .where(eq(schema.chartOfAccounts.companyId, companyId))
      .orderBy(schema.chartOfAccounts.code);
  }
}
