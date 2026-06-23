import { sql as drizzleSql } from 'drizzle-orm';
import { makeSql, makeDb, schema } from './client.js';
import { getChartOfAccounts } from '@erp/config-regimes';
import { lineNet, vatFor, receiptBalance, issueCost } from '@erp/domain';

/**
 * Demo seed. Run ONLY on a fresh database (e.g. right after `migrate` on a new install).
 * It is idempotent via a guard: if an Owner already exists the seed is SKIPPED (it will not
 * refresh/append). Do NOT share a database between the seed and the test suite — the API
 * integration tests truncate all tables, which would wipe seeded demo data. To regenerate the
 * demo, start from an empty database.
 */
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
    // VAT rates — Law on VAT 48/2024/QH15 + Resolution 204/2025/QH15
    await tx.insert(schema.taxRules).values([
      {
        // Standard VAT 10% — Luật Thuế GTGT (Law on VAT) 48/2024/QH15, Điều 8.1
        ruleType: 'vat_rate',
        value: '10',
        effectiveFrom: '2014-01-01',
        effectiveTo: null,
        sourceRegulation: 'Law on VAT 48/2024/QH15',
      },
      {
        // Reduced VAT 8% through 2026-12-31 — Nghị quyết 204/2025/QH15
        ruleType: 'vat_rate_reduced',
        value: '8',
        effectiveFrom: '2025-01-01',
        effectiveTo: '2027-01-01',
        sourceRegulation: 'Resolution 204/2025/QH15',
      },
      {
        // Reduced VAT 5% (essential goods/services) — Luật Thuế GTGT 48/2024/QH15, Điều 8.2
        ruleType: 'vat_rate_5',
        value: '5',
        effectiveFrom: '2014-01-01',
        effectiveTo: null,
        sourceRegulation: 'Law on VAT 48/2024/QH15',
      },
      {
        // Zero-rate VAT (exports, etc.) — Luật Thuế GTGT 48/2024/QH15, Điều 8.3
        ruleType: 'vat_zero',
        value: '0',
        effectiveFrom: '2014-01-01',
        effectiveTo: null,
        sourceRegulation: 'Law on VAT 48/2024/QH15',
      },
      {
        // VAT-exempt goods/services — Luật Thuế GTGT 48/2024/QH15, Điều 5
        ruleType: 'vat_exempt',
        value: '0',
        effectiveFrom: '2014-01-01',
        effectiveTo: null,
        sourceRegulation: 'Law on VAT 48/2024/QH15',
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
      lines: Array<{ accountCode: string; debitMinor: bigint; creditMinor: bigint; partnerId?: string }>;
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
          ...(l.partnerId !== undefined ? { partnerId: l.partnerId } : {}),
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

    // ── PART B: Phase 2a — Sales / AR / E-invoice demo data ──────────────────
    // Idempotency: skip if business partners already seeded for this company
    const existingPartners = await tx
      .select({ id: schema.businessPartners.id })
      .from(schema.businessPartners)
      .where(drizzleSql`${schema.businessPartners.companyId} = ${sme.id}`)
      .limit(1);

    if (existingPartners.length === 0) {
      // B1. Business partners (customers)
      //     Thông tư 133/2016/TT-BTC — chi tiết công nợ phải thu theo từng khách hàng
      const partnerRows = await tx.insert(schema.businessPartners).values([
        {
          companyId: sme.id,
          code: 'KH001',
          name: 'Công ty CP Thương mại An Phát',
          taxCode: '0312345678',
          partnerType: 'customer',
        },
        {
          companyId: sme.id,
          code: 'KH002',
          name: 'Công ty TNHH Bình Minh',
          taxCode: '0398765432',
          partnerType: 'customer',
        },
      ]).returning();
      const kh001 = partnerRows.find((p) => p.code === 'KH001')!;
      const kh002 = partnerRows.find((p) => p.code === 'KH002')!;

      // B2. Sales invoice INV-2026-001 to KH001 (Period 1/FY2026)
      //     2 lines with mixed VAT rates per Law on VAT 48/2024/QH15 + Resolution 204/2025/QH15:
      //       Line A: qty 1 × 10,000,000 @ 10% (vat_rate)  → net 10,000,000 / vat 1,000,000
      //       Line B: qty 1 ×  5,000,000 @ 8%  (vat_rate_reduced) → net 5,000,000 / vat 400,000
      //     subtotal 15,000,000 / vat_total 1,400,000 / total 16,400,000

      // Use domain helpers (bigint, HALF_UP) — never float
      const lineANet = lineNet(1n, 10_000_000n);          // 10,000,000
      const lineAVat = vatFor(lineANet, 10n);              // 1,000,000  (10%)
      const lineBNet = lineNet(1n, 5_000_000n);            // 5,000,000
      const lineBVat = vatFor(lineBNet, 8n);               // 400,000    (8%)

      const invoiceSubtotal = lineANet + lineBNet;         // 15,000,000
      const invoiceVat     = lineAVat + lineBVat;          // 1,400,000
      const invoiceTotal   = invoiceSubtotal + invoiceVat; // 16,400,000

      // Insert the invoice as draft first, then post after attaching the journal entry
      const invRows = await tx.insert(schema.salesInvoices).values({
        companyId: sme.id,
        partnerId: kh001.id,
        invoiceNo: 1,
        invoiceDate: '2026-01-20',
        periodId: period1.id,
        fiscalYear: 2026,
        description: 'Hóa đơn bán hàng 01/2026 — An Phát',
        status: 'draft',
        subtotalMinor: invoiceSubtotal,
        vatMinor: invoiceVat,
        totalMinor: invoiceTotal,
      }).returning();
      const invoice = invRows[0]!;

      // Insert invoice lines (audit trail: vatRuleType + vatRatePct stored per line)
      await tx.insert(schema.salesInvoiceLines).values([
        {
          invoiceId: invoice.id,
          companyId: sme.id,
          lineNo: 1,
          description: 'Hàng hóa A',
          quantity: 1n,
          unitPriceMinor: 10_000_000n,
          lineNetMinor: lineANet,
          vatRuleType: 'vat_rate',
          vatRatePct: 10,
          vatMinor: lineAVat,
          revenueAccountCode: '511',
        },
        {
          invoiceId: invoice.id,
          companyId: sme.id,
          lineNo: 2,
          description: 'Hàng hóa B',
          quantity: 1n,
          unitPriceMinor: 5_000_000n,
          lineNetMinor: lineBNet,
          vatRuleType: 'vat_rate_reduced',
          vatRatePct: 8,
          vatMinor: lineBVat,
          revenueAccountCode: '511',
        },
      ]);

      // Post the AR journal entry: Dr 131 16,400,000 (partner KH001) / Cr 511 15,000,000 / Cr 3331 1,400,000
      //   Source: Thông tư 133/2016/TT-BTC — hạch toán doanh thu + thuế GTGT đầu ra (TK 3331)
      //   VAT: Law on VAT 48/2024/QH15 Art. 8.1 (10%) + Resolution 204/2025/QH15 (8% through 2026-12-31)
      const e6Id = await postEntry({
        entryNo: 6,
        entryDate: '2026-01-20',
        description: 'Bán hàng chịu thuế GTGT — An Phát (INV-2026-001)',
        lines: [
          { accountCode: '131', debitMinor: invoiceTotal,    creditMinor: 0n, partnerId: kh001.id },
          { accountCode: '511', debitMinor: 0n,              creditMinor: invoiceSubtotal },
          { accountCode: '3331', debitMinor: 0n,             creditMinor: invoiceVat },
        ],
      });

      // Mark the invoice as posted and link the journal entry
      await tx.execute(
        drizzleSql`UPDATE sales_invoices SET status = 'posted', journal_entry_id = ${e6Id}, posted_at = now() WHERE id = ${invoice.id}`
      );

      // B3. Customer receipt from KH001 — partial payment 6,000,000 VND to 111
      //     Dr 111 6,000,000 / Cr 131 6,000,000 (partner KH001)
      //     Source: Thông tư 133/2016/TT-BTC — thu tiền khách hàng (sub-ledger 131)
      const receiptAmount = 6_000_000n;
      const e7Id = await postEntry({
        entryNo: 7,
        entryDate: '2026-01-25',
        description: 'Thu tiền khách hàng An Phát (phần 1)',
        lines: [
          { accountCode: '111',  debitMinor: receiptAmount, creditMinor: 0n },
          { accountCode: '131',  debitMinor: 0n,            creditMinor: receiptAmount, partnerId: kh001.id },
        ],
      });

      const rcptRows = await tx.insert(schema.customerReceipts).values({
        companyId: sme.id,
        partnerId: kh001.id,
        receiptNo: 1,
        receiptDate: '2026-01-25',
        periodId: period1.id,
        fiscalYear: 2026,
        amountMinor: receiptAmount,
        settlementAccountCode: '111',
        description: 'Thu tiền từ An Phát — thanh toán một phần HĐ 01/2026',
        status: 'posted',
        journalEntryId: e7Id,
        postedAt: new Date(),
      }).returning();
      const receipt = rcptRows[0]!;

      // B4. E-invoice stub for the sales invoice
      //     Decree 123/2020/ND-CP + Circular 78/2021/TT-BTC + GDT XML 1450/QĐ-TCT
      //     Provider: Viettel (stub — no live transmission in seed)
      //     Status: 'issued' (representative row; providerCode and gdtMessageId are demo values)
      const einvRows = await tx.insert(schema.einvoices).values({
        companyId: sme.id,
        salesInvoiceId: invoice.id,
        provider: 'viettel',
        mauSo: '1',
        kyHieu: 'C26TAA',
        soHoaDon: '00000001',
        sellerMst: sme.mst,
        buyerMst: kh001.taxCode,
        buyerName: kh001.name,
        currency: 'VND',
        subtotalMinor: invoiceSubtotal,
        vatMinor: invoiceVat,
        totalMinor: invoiceTotal,
        status: 'issued',
        providerCode: 'VT-DEMO0001',
        gdtMessageId: 'GDT-VT-DEMO0001',
        issuedAt: new Date(),
        payload: {
          demo: true,
          note: 'Stub e-invoice — Decree 123/2020/ND-CP + Circular 78/2021/TT-BTC + GDT XML 1450/QĐ-TCT',
        },
      }).returning();
      const einvoice = einvRows[0]!;

      // AR balance for KH001 = invoiceTotal − receiptAmount = 16,400,000 − 6,000,000 = 10,400,000
      const arBalance = invoiceTotal - receiptAmount;

      console.log(JSON.stringify({
        phase2a: {
          partners: {
            KH001: { id: kh001.id, taxCode: kh001.taxCode },
            KH002: { id: kh002.id, taxCode: kh002.taxCode },
          },
          salesInvoice: {
            id: invoice.id,
            invoiceNo: 1,
            subtotalMinor: invoiceSubtotal.toString(),
            vatMinor: invoiceVat.toString(),
            totalMinor: invoiceTotal.toString(),
            journalEntryId: e6Id,
          },
          customerReceipt: {
            id: receipt.id,
            amountMinor: receiptAmount.toString(),
            journalEntryId: e7Id,
          },
          einvoice: {
            id: einvoice.id,
            status: einvoice.status,
            provider: einvoice.provider,
            soHoaDon: einvoice.soHoaDon,
          },
          arBalanceKH001: arBalance.toString(),
          arCheck: arBalance === 10_400_000n ? 'PASS — KH001 AR = 10,400,000' : `FAIL — got ${arBalance}`,
        },
      }, null, 2));
    } else {
      console.log('Phase 2a sales data already seeded — skipping');
    }

    // ── PART C: Phase 2b — Materials Management / Procure-to-Pay demo data ────────────────
    // Idempotency: skip if materials already seeded for this company
    const existingMaterials = await tx
      .select({ id: schema.materials.id })
      .from(schema.materials)
      .where(drizzleSql`${schema.materials.companyId} = ${sme.id}`)
      .limit(1);

    if (existingMaterials.length === 0) {
      // C1. Vendor business_partner
      //     Thông tư 133/2016/TT-BTC — chi tiết công nợ phải trả theo từng nhà cung cấp
      //     AP (TK 331) sub-ledger uses the same partner_id dimension as AR (TK 131)
      const vendorRows = await tx.insert(schema.businessPartners).values({
        companyId: sme.id,
        code: 'NCC001',
        name: 'Công ty TNHH Vật tư Hà Nội',
        taxCode: '0105566778',
        partnerType: 'vendor',
      }).returning();
      const vendor = vendorRows[0]!;

      // C2. Material master
      //     TK 152 — Nguyên liệu, vật liệu (raw materials)
      //     TK 156 — Hàng hóa (merchandise)
      //     Basis: Thông tư 133/2016/TT-BTC, Phụ lục 1; VAS 02 — weighted-average inventory method
      const materialRows = await tx.insert(schema.materials).values([
        {
          companyId: sme.id,
          code: 'VT001',
          name: 'Nguyên vật liệu A',
          unit: 'kg',
          inventoryAccountCode: '152',
        },
        {
          companyId: sme.id,
          code: 'HH001',
          name: 'Hàng hóa B',
          unit: 'cái',
          inventoryAccountCode: '156',
        },
      ]).returning();
      const vt001 = materialRows.find((m) => m.code === 'VT001')!;
      const hh001 = materialRows.find((m) => m.code === 'HH001')!;

      // C3. Purchase invoice (Period 1/FY2026) — goods receipt + input VAT + AP posting
      //     Line 1: 100 kg VT001 @ 50,000 each = 5,000,000 (net) @ 10% input VAT → 500,000
      //     Line 2: 200 cái HH001 @ 30,000 each = 6,000,000 (net) @ 8% input VAT → 480,000
      //     Subtotal: 11,000,000 | VAT: 980,000 | Total: 11,980,000
      //
      //     Input VAT deductibility conditions:
      //       - 10% rate: Law on VAT 48/2024/QH15, Điều 8.1 (standard rate)
      //       - 8% reduced rate through 2026-12-31: Resolution 204/2025/QH15
      //       - Non-cash payment required for invoice ≥ VND 5,000,000 (effective 2025-07-01):
      //         Law 48/2024/QH15 (input-VAT deductibility condition); Decree 181/2025
      //     Inventory / AP basis: Thông tư 133/2016/TT-BTC; VAS 02

      // Line cost computation using bigint helpers — no floats
      // VT001 line: qty 100 @ unitCost 50,000 → lineCost 5,000,000
      const piLine1Qty      = 100n;
      const piLine1Unit     = 50_000n;
      const piLine1Cost     = piLine1Qty * piLine1Unit;          // 5,000,000
      const piLine1Vat      = vatFor(piLine1Cost, 10n);          // 500,000 (10%)

      // HH001 line: qty 200 @ unitCost 30,000 → lineCost 6,000,000
      // VAT reduced rate 8% through 2026-12-31 — Resolution 204/2025/QH15
      const piLine2Qty      = 200n;
      const piLine2Unit     = 30_000n;
      const piLine2Cost     = piLine2Qty * piLine2Unit;          // 6,000,000
      const piLine2Vat      = vatFor(piLine2Cost, 8n);           // 480,000 (8%)

      const piSubtotal      = piLine1Cost + piLine2Cost;         // 11,000,000
      const piVat           = piLine1Vat + piLine2Vat;           // 980,000
      const piTotal         = piSubtotal + piVat;                // 11,980,000

      // Insert purchase invoice (draft → post after journal)
      const piRows = await tx.insert(schema.purchaseInvoices).values({
        companyId: sme.id,
        partnerId: vendor.id,
        invoiceNo: 1,
        invoiceDate: '2026-01-12',
        periodId: period1.id,
        fiscalYear: 2026,
        description: 'Mua nguyên vật liệu và hàng hóa — NCC001 (01/2026)',
        status: 'draft',
        nonCashPayment: true,   // ≥ VND 5,000,000 → non-cash payment condition (Law 48/2024)
        subtotalMinor: piSubtotal,
        vatMinor: piVat,
        totalMinor: piTotal,
      }).returning();
      const pi = piRows[0]!;

      // Insert purchase invoice lines
      await tx.insert(schema.purchaseInvoiceLines).values([
        {
          invoiceId: pi.id,
          companyId: sme.id,
          lineNo: 1,
          materialId: vt001.id,
          quantity: piLine1Qty,
          unitCostMinor: piLine1Unit,
          lineCostMinor: piLine1Cost,
          vatRuleType: 'vat_rate',
          vatRatePct: 10,
          vatMinor: piLine1Vat,
          inventoryAccountCode: '152',
        },
        {
          invoiceId: pi.id,
          companyId: sme.id,
          lineNo: 2,
          materialId: hh001.id,
          quantity: piLine2Qty,
          unitCostMinor: piLine2Unit,
          lineCostMinor: piLine2Cost,
          // VAT reduced rate 8% through 2026-12-31 — Resolution 204/2025/QH15
          vatRuleType: 'vat_rate_reduced',
          vatRatePct: 8,
          vatMinor: piLine2Vat,
          inventoryAccountCode: '156',
        },
      ]);

      // Post the AP journal entry:
      //   Dr 152  5,000,000  (nguyên vật liệu nhập kho — VT001)
      //   Dr 156  6,000,000  (hàng hóa nhập kho — HH001)
      //   Dr 1331   980,000  (thuế GTGT đầu vào được khấu trừ)
      //   Cr 331 11,980,000  (phải trả nhà cung cấp — NCC001)
      //   Source: Thông tư 133/2016/TT-BTC — hạch toán mua hàng + thuế GTGT đầu vào (TK 1331)
      //           VAS 02 — nhập kho theo giá thực tế (actual cost)
      //           Law 48/2024/QH15 — điều kiện khấu trừ thuế GTGT đầu vào (nonCashPayment flag)
      const e8Id = await postEntry({
        entryNo: 8,
        entryDate: '2026-01-12',
        description: 'Mua NVL + hàng hóa nhập kho, ghi nhận thuế GTGT đầu vào (PI-2026-001)',
        lines: [
          { accountCode: '152',  debitMinor: piLine1Cost, creditMinor: 0n },
          { accountCode: '156',  debitMinor: piLine2Cost, creditMinor: 0n },
          { accountCode: '1331', debitMinor: piVat,       creditMinor: 0n },
          { accountCode: '331',  debitMinor: 0n,          creditMinor: piTotal, partnerId: vendor.id },
        ],
      });

      // Mark purchase invoice posted and link journal entry
      await tx.execute(
        drizzleSql`UPDATE purchase_invoices SET status = 'posted', journal_entry_id = ${e8Id}, posted_at = now() WHERE id = ${pi.id}`
      );

      // C3b. Inventory movements — goods receipt (type 'receipt')
      //      Weighted-average receipt via receiptBalance() — VAS 02 / Circular 133
      //      Starting balance is 0 qty / 0 value for each material (fresh seed)

      // VT001 receipt: qty 100, cost 5,000,000
      const vt001BalAfterReceipt = receiptBalance(0n, 0n, piLine1Qty, piLine1Cost);
      // { qty: 100, value: 5,000,000 }
      await tx.insert(schema.inventoryMovements).values({
        companyId: sme.id,
        materialId: vt001.id,
        movementType: 'receipt',
        quantity: piLine1Qty,
        unitCostMinor: piLine1Unit,
        totalCostMinor: piLine1Cost,
        balanceQtyAfter: vt001BalAfterReceipt.qty,
        balanceValueAfter: vt001BalAfterReceipt.value,
        sourceDocType: 'purchase_invoice',
        sourceDocId: pi.id,
        journalEntryId: e8Id,
        movementDate: '2026-01-12',
        periodId: period1.id,
      });

      // HH001 receipt: qty 200, cost 6,000,000
      const hh001BalAfterReceipt = receiptBalance(0n, 0n, piLine2Qty, piLine2Cost);
      // { qty: 200, value: 6,000,000 }
      await tx.insert(schema.inventoryMovements).values({
        companyId: sme.id,
        materialId: hh001.id,
        movementType: 'receipt',
        quantity: piLine2Qty,
        unitCostMinor: piLine2Unit,
        totalCostMinor: piLine2Cost,
        balanceQtyAfter: hh001BalAfterReceipt.qty,
        balanceValueAfter: hh001BalAfterReceipt.value,
        sourceDocType: 'purchase_invoice',
        sourceDocId: pi.id,
        journalEntryId: e8Id,
        movementDate: '2026-01-12',
        periodId: period1.id,
      });

      // C4. Goods issue (Period 1): issue 50 kg VT001 → COGS at weighted-average cost
      //     Weighted-average unit cost of VT001 = 5,000,000 / 100 = 50,000/kg
      //     Issue qty 50 → costOut = 50/100 × 5,000,000 = 2,500,000
      //     Basis: VAS 02 / Thông tư 133/2016/TT-BTC — phương pháp bình quân gia quyền
      const giQty = 50n;
      const vt001IssueResult = issueCost(
        vt001BalAfterReceipt.qty,    // 100
        vt001BalAfterReceipt.value,  // 5,000,000
        giQty,                       // 50
      );
      // vt001IssueResult.costOut = 2,500,000; .qty = 50; .value = 2,500,000

      // Insert goods issue (draft → post)
      const giRows = await tx.insert(schema.goodsIssues).values({
        companyId: sme.id,
        issueNo: 1,
        issueDate: '2026-01-20',
        periodId: period1.id,
        fiscalYear: 2026,
        reason: 'consumption',
        description: 'Xuất kho VT001 phục vụ sản xuất (GI-2026-001)',
        status: 'draft',
        totalCostMinor: vt001IssueResult.costOut,
      }).returning();
      const gi = giRows[0]!;

      await tx.insert(schema.goodsIssueLines).values({
        issueId: gi.id,
        companyId: sme.id,
        lineNo: 1,
        materialId: vt001.id,
        quantity: giQty,
        costMinor: vt001IssueResult.costOut,
        cogsAccountCode: '632',
      });

      // Post the COGS journal entry:
      //   Dr 632  2,500,000  (giá vốn hàng bán / xuất kho nguyên vật liệu)
      //   Cr 152  2,500,000  (xuất kho nguyên vật liệu)
      //   Source: Thông tư 133/2016/TT-BTC — hạch toán giá vốn hàng xuất kho
      //           VAS 02 — phương pháp bình quân gia quyền liên hoàn
      const e9Id = await postEntry({
        entryNo: 9,
        entryDate: '2026-01-20',
        description: 'Xuất kho nguyên vật liệu ghi nhận giá vốn — bình quân gia quyền (GI-2026-001)',
        lines: [
          { accountCode: '632', debitMinor: vt001IssueResult.costOut, creditMinor: 0n },
          { accountCode: '152', debitMinor: 0n,                       creditMinor: vt001IssueResult.costOut },
        ],
      });

      // Mark goods issue posted and link journal
      await tx.execute(
        drizzleSql`UPDATE goods_issues SET status = 'posted', journal_entry_id = ${e9Id}, posted_at = now() WHERE id = ${gi.id}`
      );

      // VT001 inventory movement — issue
      const vt001BalAfterIssue = { qty: vt001IssueResult.qty, value: vt001IssueResult.value };
      await tx.insert(schema.inventoryMovements).values({
        companyId: sme.id,
        materialId: vt001.id,
        movementType: 'issue',
        quantity: giQty,
        unitCostMinor: vt001IssueResult.costOut / giQty,  // 50,000 per kg (exact: costOut/qty)
        totalCostMinor: vt001IssueResult.costOut,
        balanceQtyAfter: vt001BalAfterIssue.qty,
        balanceValueAfter: vt001BalAfterIssue.value,
        sourceDocType: 'goods_issue',
        sourceDocId: gi.id,
        journalEntryId: e9Id,
        movementDate: '2026-01-20',
        periodId: period1.id,
      });

      // C5. Vendor payment — partial payment of 4,000,000 VND via cash (111)
      //     Dr 331  4,000,000  (thanh toán nhà cung cấp — NCC001)
      //     Cr 111  4,000,000  (tiền mặt)
      //     AP balance after: 11,980,000 − 4,000,000 = 7,980,000
      //     Source: Thông tư 133/2016/TT-BTC — hạch toán thanh toán công nợ phải trả
      const vpAmount = 4_000_000n;
      const vpRows = await tx.insert(schema.vendorPayments).values({
        companyId: sme.id,
        partnerId: vendor.id,
        paymentNo: 1,
        paymentDate: '2026-01-28',
        periodId: period1.id,
        fiscalYear: 2026,
        amountMinor: vpAmount,
        settlementAccountCode: '111',
        description: 'Thanh toán tiền mặt nhà cung cấp NCC001 — một phần PI-2026-001',
        status: 'draft',
      }).returning();
      const vp = vpRows[0]!;

      // Post the AP settlement journal entry:
      //   Dr 331  4,000,000  (giảm phải trả nhà cung cấp — NCC001)
      //   Cr 111  4,000,000  (tiền mặt thanh toán)
      //   Source: Thông tư 133/2016/TT-BTC — thanh toán công nợ phải trả người bán
      const e10Id = await postEntry({
        entryNo: 10,
        entryDate: '2026-01-28',
        description: 'Thanh toán nhà cung cấp NCC001 (VP-2026-001)',
        lines: [
          { accountCode: '331', debitMinor: vpAmount, creditMinor: 0n, partnerId: vendor.id },
          { accountCode: '111', debitMinor: 0n,       creditMinor: vpAmount },
        ],
      });

      // Mark vendor payment posted and link journal
      await tx.execute(
        drizzleSql`UPDATE vendor_payments SET status = 'posted', journal_entry_id = ${e10Id}, posted_at = now() WHERE id = ${vp.id}`
      );

      // ── Phase 2b summary + reconciliation checks ──────────────────────────
      const apBalance       = piTotal - vpAmount;                   // 11,980,000 − 4,000,000 = 7,980,000
      const vt001OnHandQty  = vt001BalAfterIssue.qty;              // 50
      const vt001OnHandVal  = vt001BalAfterIssue.value;             // 2,500,000
      const hh001OnHandQty  = hh001BalAfterReceipt.qty;            // 200
      const hh001OnHandVal  = hh001BalAfterReceipt.value;           // 6,000,000
      const inventoryTotal  = vt001OnHandVal + hh001OnHandVal;      // 8,500,000 (TB 152+156 net)

      console.log(JSON.stringify({
        phase2b: {
          vendor: { id: vendor.id, code: vendor.code, taxCode: vendor.taxCode },
          materials: {
            VT001: { id: vt001.id, onHandQty: vt001OnHandQty.toString(), onHandValue: vt001OnHandVal.toString() },
            HH001: { id: hh001.id, onHandQty: hh001OnHandQty.toString(), onHandValue: hh001OnHandVal.toString() },
          },
          purchaseInvoice: {
            id: pi.id, invoiceNo: 1,
            subtotal: piSubtotal.toString(), vat: piVat.toString(), total: piTotal.toString(),
            journalEntryId: e8Id,
          },
          goodsIssue: {
            id: gi.id, issueNo: 1,
            costOut: vt001IssueResult.costOut.toString(),
            journalEntryId: e9Id,
          },
          vendorPayment: {
            id: vp.id, paymentNo: 1,
            amount: vpAmount.toString(),
            journalEntryId: e10Id,
          },
          reconciliation: {
            vendorAPBalance: apBalance.toString(),
            apCheck: apBalance === 7_980_000n ? 'PASS — AP NCC001 = 7,980,000' : `FAIL — got ${apBalance}`,
            vt001OnHandCheck: (vt001OnHandQty === 50n && vt001OnHandVal === 2_500_000n)
              ? 'PASS — VT001 qty 50 / value 2,500,000'
              : `FAIL — qty ${vt001OnHandQty} / value ${vt001OnHandVal}`,
            hh001OnHandCheck: (hh001OnHandQty === 200n && hh001OnHandVal === 6_000_000n)
              ? 'PASS — HH001 qty 200 / value 6,000,000'
              : `FAIL — qty ${hh001OnHandQty} / value ${hh001OnHandVal}`,
            inventoryTotal: inventoryTotal.toString(),
            inventoryTotalCheck: inventoryTotal === 8_500_000n
              ? 'PASS — inventory total (TB 152+156 net receipt) = 8,500,000'
              : `FAIL — got ${inventoryTotal}`,
            note: 'TB 152 net = 5,000,000 receipt − 2,500,000 issue = 2,500,000; TB 156 net = 6,000,000; sum = 8,500,000',
          },
        },
      }, null, 2));
    } else {
      console.log('Phase 2b MM data already seeded — skipping');
    }

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
