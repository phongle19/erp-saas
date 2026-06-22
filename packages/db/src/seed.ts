import { sql as drizzleSql } from 'drizzle-orm';
import { makeSql, makeDb, schema } from './client.js';
import { getChartOfAccounts } from '@erp/config-regimes';

async function main() {
  const sqlClient = makeSql();
  const db = makeDb(sqlClient);

  // idempotency guard — owner table has no RLS, readable without admin GUC
  const existing = await sqlClient`SELECT count(*)::int AS n FROM owner`;
  if (existing[0]!.n > 0) {
    console.log('owner already exists — seed skipped');
    await sqlClient.end();
    return;
  }

  await db.transaction(async (tx) => {
    // Set admin GUC so FORCE RLS WITH CHECK passes for companies, groups, group_memberships
    await tx.execute(drizzleSql`SELECT set_config('app.is_admin','true',true)`);

    // Currencies — no RLS, but onConflictDoNothing for safety
    await tx.insert(schema.currencies).values([
      { code: 'VND', name: 'Vietnamese Dong', minorUnitScale: 0 },
      { code: 'USD', name: 'US Dollar', minorUnitScale: 2 },
    ]).onConflictDoNothing();

    // Owner
    const ownRows = await tx.insert(schema.owner).values({
      name: 'Demo Owner',
      defaultLocale: 'vi',
    }).returning();
    const own = ownRows[0]!;

    // Companies
    const smeRows = await tx.insert(schema.companies).values({
      ownerId: own.id,
      name: 'Công ty TNHH Demo SME',
      mst: '0101234567',
      regime: 'circular_133',
      functionalCurrency: 'VND',
    }).returning();
    const sme = smeRows[0]!;

    const hkdRows = await tx.insert(schema.companies).values({
      ownerId: own.id,
      name: 'Hộ kinh doanh Demo',
      mst: '8101234567',
      regime: 'circular_88',
      functionalCurrency: 'VND',
      householdTier: '200m_1b',
    }).returning();
    const hkd = hkdRows[0]!;

    // Management portfolio group spanning both companies
    const grpRows = await tx.insert(schema.groups).values({
      ownerId: own.id,
      name: 'Danh mục tổng hợp (Portfolio)',
      type: 'MANAGEMENT',
      reportingCurrency: 'VND',
    }).returning();
    const grp = grpRows[0]!;

    await tx.insert(schema.groupMemberships).values([
      { groupId: grp.id, companyId: sme.id },
      { groupId: grp.id, companyId: hkd.id },
    ]);

    // Effective-dated tax rules
    // Note: effectiveTo is EXCLUSIVE — 8% reduced rate through 2026-12-31 => effectiveTo '2027-01-01'
    await tx.insert(schema.taxRules).values([
      {
        ruleType: 'vat_rate',
        value: '10',
        effectiveFrom: '2014-01-01',
        effectiveTo: null,
        sourceRegulation: 'Law on VAT',
      },
      {
        ruleType: 'vat_rate_reduced',
        value: '8',
        effectiveFrom: '2025-01-01',
        effectiveTo: '2027-01-01',
        sourceRegulation: 'Resolution 204/2025/QH15',
      },
      {
        ruleType: 'input_vat_noncash_threshold',
        value: '5000000',
        effectiveFrom: '2025-07-01',
        effectiveTo: null,
        sourceRegulation: 'Law 48/2024/QH15',
      },
      {
        ruleType: 'household_tier_threshold_exempt',
        value: '200000000',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        sourceRegulation: 'Resolution 198/2025/QH15',
      },
    ]);

    // ── PART A: SME accounting data ──────────────────────────────────────────

    // 1. Provision Circular 133 Chart of Accounts for SME
    //    Source: Thông tư 133/2016/TT-BTC, Phụ lục 1
    const tt133Accounts = getChartOfAccounts('circular_133');
    await tx.insert(schema.chartOfAccounts)
      .values(tt133Accounts.map((a) => ({
        companyId: sme.id,
        code: a.code,
        name: a.name,
        type: a.type,
      })))
      .onConflictDoNothing();

    // 2. Create FY2026 accounting periods for SME
    //    Source: Luật Kế toán số 88/2015/QH13, Điều 13 (kỳ kế toán)
    //    Regular periods 1–12 (monthly, Jan-Dec 2026) + 3 special periods
    const regularPeriods = Array.from({ length: 12 }, (_, i) => {
      const monthNo = i + 1;
      // Build YYYY-MM-DD start/end dates for each month
      const year = 2026;
      const startMonth = String(monthNo).padStart(2, '0');
      const startDate = `${year}-${startMonth}-01`;
      // End date: first day of next month minus 1 day
      const nextMonth = monthNo === 12 ? 1 : monthNo + 1;
      const nextYear = monthNo === 12 ? year + 1 : year;
      // Days in month: Date(year, month, 0) gives last day of the previous month
      const lastDay = new Date(nextYear, nextMonth - 1, 0).getDate();
      const endDate = `${year}-${startMonth}-${String(lastDay).padStart(2, '0')}`;
      return {
        companyId: sme.id,
        fiscalYear: year,
        periodNo: monthNo,
        periodType: 'regular' as const,
        purpose: null,
        nameVi: `Tháng ${monthNo}/${year}`,
        startDate,
        endDate,
        status: 'open' as const,
      };
    });

    const specialPeriods = [
      {
        companyId: sme.id,
        fiscalYear: 2026,
        periodNo: 13,
        periodType: 'special' as const,
        purpose: 'closing',
        nameVi: 'Điều chỉnh khóa sổ cuối năm',
        startDate: null,
        endDate: null,
        status: 'open' as const,
      },
      {
        companyId: sme.id,
        fiscalYear: 2026,
        periodNo: 14,
        periodType: 'special' as const,
        purpose: 'audit',
        nameVi: 'Điều chỉnh kiểm toán',
        startDate: null,
        endDate: null,
        status: 'open' as const,
      },
      {
        companyId: sme.id,
        fiscalYear: 2026,
        periodNo: 15,
        periodType: 'special' as const,
        purpose: 'retrospective',
        nameVi: 'Điều chỉnh hồi tố',
        startDate: null,
        endDate: null,
        status: 'open' as const,
      },
    ];

    const periodInserts = await tx.insert(schema.accountingPeriods)
      .values([...regularPeriods, ...specialPeriods])
      .onConflictDoNothing()
      .returning();

    // Get period 1 (January 2026) for journal entries
    // After insertion we query to be safe (onConflictDoNothing may skip rows)
    const period1Rows = await tx
      .select()
      .from(schema.accountingPeriods)
      .where(
        drizzleSql`${schema.accountingPeriods.companyId} = ${sme.id}
          AND ${schema.accountingPeriods.fiscalYear} = 2026
          AND ${schema.accountingPeriods.periodNo} = 1`
      );
    const period1 = period1Rows[0]!;

    // Build a map: account code → account id (for SME)
    const allSmeAccounts = await tx
      .select({ id: schema.chartOfAccounts.id, code: schema.chartOfAccounts.code })
      .from(schema.chartOfAccounts)
      .where(drizzleSql`${schema.chartOfAccounts.companyId} = ${sme.id}`);
    const codeToId = new Map<string, string>(allSmeAccounts.map((a) => [a.code, a.id]));

    const acct = (code: string): string => {
      const id = codeToId.get(code);
      if (!id) throw new Error(`Account code ${code} not found in SME CoA`);
      return id;
    };

    // 3. Post balanced journal entries for FY2026 Period 1
    //    Source: Luật Kế toán số 88/2015/QH13, Điều 17 (bút toán kép)
    //    IMPORTANT: draft → insert lines → update to posted (trigger enforcement)

    // Helper: create one journal entry with its lines, then post it
    const postEntry = async (params: {
      entryNo: number;
      entryDate: string;
      description: string;
      lines: Array<{ accountCode: string; debitMinor: bigint; creditMinor: bigint }>;
    }) => {
      // (a) Insert entry as draft
      const entryRows = await tx.insert(schema.journalEntries).values({
        companyId: sme.id,
        periodId: period1.id,
        fiscalYear: 2026,
        entryNo: params.entryNo,
        entryDate: params.entryDate,
        description: params.description,
        status: 'draft',
      }).returning();
      const entry = entryRows[0]!;

      // (b) Insert balanced lines
      await tx.insert(schema.journalLines).values(
        params.lines.map((l) => ({
          entryId: entry.id,
          companyId: sme.id,
          accountId: acct(l.accountCode),
          debitMinor: l.debitMinor,
          creditMinor: l.creditMinor,
        }))
      );

      // (c) Post the entry (triggers deferred balance check at COMMIT)
      await tx.execute(
        drizzleSql`UPDATE journal_entries SET status = 'posted', posted_at = now() WHERE id = ${entry.id}`
      );

      return entry.id;
    };

    // E1: Góp vốn — Dr 111 / Cr 411
    //   Chủ sở hữu góp vốn bằng tiền mặt: 2,000,000,000 VND
    const e1Id = await postEntry({
      entryNo: 1,
      entryDate: '2026-01-05',
      description: 'Chủ sở hữu góp vốn bằng tiền mặt',
      lines: [
        { accountCode: '111', debitMinor: 2_000_000_000n, creditMinor: 0n },
        { accountCode: '411', debitMinor: 0n, creditMinor: 2_000_000_000n },
      ],
    });

    // E2: Mua hàng nhập kho — Dr 156 / Cr 111
    //   Mua hàng hóa nhập kho trả tiền mặt: 800,000,000 VND
    const e2Id = await postEntry({
      entryNo: 2,
      entryDate: '2026-01-10',
      description: 'Mua hàng hóa nhập kho, trả tiền mặt',
      lines: [
        { accountCode: '156', debitMinor: 800_000_000n, creditMinor: 0n },
        { accountCode: '111', debitMinor: 0n, creditMinor: 800_000_000n },
      ],
    });

    // E3: Bán hàng thu tiền — Dr 111 / Cr 511
    //   Bán hàng hóa thu tiền mặt: 1,200,000,000 VND
    const e3Id = await postEntry({
      entryNo: 3,
      entryDate: '2026-01-15',
      description: 'Bán hàng hóa thu tiền mặt',
      lines: [
        { accountCode: '111', debitMinor: 1_200_000_000n, creditMinor: 0n },
        { accountCode: '511', debitMinor: 0n, creditMinor: 1_200_000_000n },
      ],
    });

    // E4: Giá vốn hàng bán — Dr 632 / Cr 156
    //   Xuất kho giá vốn hàng bán: 700,000,000 VND
    const e4Id = await postEntry({
      entryNo: 4,
      entryDate: '2026-01-15',
      description: 'Xuất kho ghi nhận giá vốn hàng bán',
      lines: [
        { accountCode: '632', debitMinor: 700_000_000n, creditMinor: 0n },
        { accountCode: '156', debitMinor: 0n, creditMinor: 700_000_000n },
      ],
    });

    // E5: Chi phí quản lý kinh doanh — Dr 642 / Cr 111
    //   Chi phí quản lý doanh nghiệp tháng 1/2026: 150,000,000 VND
    const e5Id = await postEntry({
      entryNo: 5,
      entryDate: '2026-01-31',
      description: 'Chi phí quản lý kinh doanh tháng 1/2026',
      lines: [
        { accountCode: '642', debitMinor: 150_000_000n, creditMinor: 0n },
        { accountCode: '111', debitMinor: 0n, creditMinor: 150_000_000n },
      ],
    });

    // Summary output
    const entryIds = [e1Id, e2Id, e3Id, e4Id, e5Id];
    console.log(JSON.stringify({
      ownerId: own.id,
      smeId: sme.id,
      hkdId: hkd.id,
      groupId: grp.id,
      coaAccountsInserted: tt133Accounts.length,
      periodsInserted: periodInserts.length,
      journalEntriesPosted: entryIds.length,
      journalEntryIds: {
        E1_gopVon: e1Id,
        E2_muaHang: e2Id,
        E3_banHang: e3Id,
        E4_giaVon: e4Id,
        E5_chiPhiQL: e5Id,
      },
      expectedTrialBalance: {
        '111_cash_debit': '2,000,000,000 + 1,200,000,000 - 800,000,000 - 150,000,000 = 2,250,000,000',
        '156_inventory_debit': '800,000,000 - 700,000,000 = 100,000,000',
        '411_equity_credit': '2,000,000,000',
        '511_revenue_credit': '1,200,000,000',
        '632_cogs_debit': '700,000,000',
        '642_opex_debit': '150,000,000',
        grossProfit: '1,200,000,000 - 700,000,000 = 500,000,000',
        operatingProfit: '500,000,000 - 150,000,000 = 350,000,000',
      },
    }, null, 2));
  });

  await sqlClient.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
