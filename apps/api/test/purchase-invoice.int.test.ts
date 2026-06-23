/**
 * Integration tests for purchase-invoice create+post (B5): goods receipt +
 * input VAT + AP, mirroring the A5 sales-invoice tests.
 *   - POST /companies/:id/purchase-invoices  (createAndPost — posts immediately)
 *   - GET  /purchase-invoices/:id
 *   - POST /purchase-invoices/:id/cancel
 *
 * DB-backed, runs as the NOBYPASSRLS `erp` role, so the P4 double-entry +
 * immutability triggers are in force. Proves:
 *   - Dr 156 (grouped) / Dr 1331 / Cr 331 posting with vendor partnerId on AP,
 *   - bigint-exact input VAT (HALF_UP), per-line vatRatePct recorded,
 *   - weighted-average goods receipt: on-hand qty + value rise per material,
 *   - effective-dated rejection (8% window closed after 2026-12-31),
 *   - 1331 omitted for an all-exempt invoice,
 *   - cancel reverses the entry AND the inventory (on-hand back to before),
 *     AP nets back to zero, re-cancel → 422,
 *   - invoiceNo increments per (company, fiscalYear),
 *   - a vendor / material from another company is rejected (422).
 *
 * Gated on TEST_DATABASE_URL / DATABASE_URL.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { makeApp, closeApp, type TestApp } from './helpers/make-app.js';
import { seedTwoCompaniesAndUsers } from './helpers/seed-test.js';

const DB_URL = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const maybe = DB_URL ? describe : describe.skip;

let app: TestApp;
let adminCookie: string;
let smeId: string;
let hkdId: string;
let vendorId: string;
let hkdVendorId: string;
let matAId: string; // 156 (goods)
let matBId: string; // 156 (goods)
let hkdMatId: string;

/** Fetch the SME's open period for a given periodNo in FY. */
async function periodId(periodNo: number, fy = 2026): Promise<string> {
  const res = await request(app.getHttpServer())
    .get(`/companies/${smeId}/periods?fiscalYear=${fy}`)
    .set('Cookie', adminCookie);
  const p = res.body.find((x: { periodNo: number }) => x.periodNo === periodNo);
  if (!p) throw new Error(`period ${periodNo}/${fy} not found`);
  return p.id as string;
}

async function seedVatRules(): Promise<void> {
  await app.rawSql.unsafe(`
    INSERT INTO tax_rules (rule_type, value, effective_from, effective_to, source_regulation) VALUES
      ('vat_rate',         '10', '2014-01-01', NULL,         'Law on VAT 48/2024/QH15'),
      ('vat_rate_reduced', '8',  '2025-01-01', '2027-01-01', 'Resolution 204/2025/QH15'),
      ('vat_rate_5',       '5',  '2014-01-01', NULL,         'Law on VAT 48/2024/QH15'),
      ('vat_zero',         '0',  '2014-01-01', NULL,         'Law on VAT 48/2024/QH15'),
      ('vat_exempt',       '0',  '2014-01-01', NULL,         'Law on VAT 48/2024/QH15');
  `);
}

/** Run a query inside an admin-context tx so FORCE RLS is satisfied via GUCs. */
async function adminQuery<T>(companyId: string, sqlText: string): Promise<T[]> {
  return app.rawSql.begin(async (tx) => {
    await tx.unsafe(
      `SELECT set_config('app.user_id','00000000-0000-0000-0000-000000000001', true)`,
    );
    await tx.unsafe(`SELECT set_config('app.is_admin','true', true)`);
    await tx.unsafe(
      `SELECT set_config('app.accessible_companies','${companyId}', true)`,
    );
    return tx.unsafe(sqlText);
  }) as Promise<T[]>;
}

async function accountId(companyId: string, code: string): Promise<string> {
  const rows = await adminQuery<{ id: string }>(
    companyId,
    `SELECT id FROM chart_of_accounts WHERE company_id = '${companyId}' AND code = '${code}'`,
  );
  return rows[0]!.id;
}

/** AP balance (credit-positive) on 331 for a vendor: Σ(credit − debit). */
async function apBalance(companyId: string, partnerId: string): Promise<bigint> {
  const acct331 = await accountId(companyId, '331');
  const rows = await adminQuery<{ bal: string }>(
    companyId,
    `SELECT COALESCE(SUM(credit_minor - debit_minor),0)::text AS bal
       FROM journal_lines
       WHERE company_id = '${companyId}' AND account_id = '${acct331}'
         AND partner_id = '${partnerId}'`,
  );
  return BigInt(rows[0]!.bal);
}

/** On-hand {qty, value} for a material via the valuation report endpoint. */
async function onHand(
  companyId: string,
  materialId: string,
): Promise<{ qty: bigint; value: bigint }> {
  const res = await request(app.getHttpServer())
    .get(`/companies/${companyId}/inventory`)
    .set('Cookie', adminCookie);
  if (res.status !== 200) throw new Error(`valuation report ${res.status}`);
  const row = (res.body.rows as Array<{ materialId: string; qty: string; value: string }>).find(
    (r) => r.materialId === materialId,
  );
  if (!row) return { qty: 0n, value: 0n }; // no movements yet → not in report
  return { qty: BigInt(row.qty), value: BigInt(row.value) };
}

maybe('Purchase invoice posting — goods receipt + input VAT + AP', () => {
  beforeAll(async () => {
    app = await makeApp();
    ({ adminCookie, smeId, hkdId } = await seedTwoCompaniesAndUsers(app));

    await seedVatRules();

    for (const id of [smeId, hkdId]) {
      const prov = await request(app.getHttpServer())
        .post(`/companies/${id}/coa/provision`)
        .set('Cookie', adminCookie);
      expect(prov.status).toBe(200);
    }

    for (const fy of [2026, 2027]) {
      const res = await request(app.getHttpServer())
        .post(`/companies/${smeId}/fiscal-years`)
        .set('Cookie', adminCookie)
        .send({ fiscalYear: fy });
      expect(res.status).toBe(200);
    }

    // Vendor (partnerType vendor) for the SME.
    const vendor = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'V001', name: 'Nhà cung cấp A', partnerType: 'vendor' });
    expect(vendor.status).toBe(201);
    vendorId = vendor.body.id as string;

    // Vendor for the OTHER company (cross-company test).
    const hkdVendor = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'HV001', name: 'NCC HKD', partnerType: 'vendor' });
    expect(hkdVendor.status).toBe(201);
    hkdVendorId = hkdVendor.body.id as string;

    // Two SME materials (both default 156 goods).
    const mA = await request(app.getHttpServer())
      .post(`/companies/${smeId}/materials`)
      .set('Cookie', adminCookie)
      .send({ code: 'M-A', name: 'Vật tư A' });
    expect(mA.status).toBe(201);
    matAId = mA.body.id as string;

    const mB = await request(app.getHttpServer())
      .post(`/companies/${smeId}/materials`)
      .set('Cookie', adminCookie)
      .send({ code: 'M-B', name: 'Vật tư B' });
    expect(mB.status).toBe(201);
    matBId = mB.body.id as string;

    // A material belonging to the OTHER company (cross-company test).
    const hkdMat = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/materials`)
      .set('Cookie', adminCookie)
      .send({ code: 'HM', name: 'Vật tư HKD' });
    expect(hkdMat.status).toBe(201);
    hkdMatId = hkdMat.body.id as string;
  });

  afterAll(async () => {
    await closeApp(app);
  });

  // -------------------------------------------------------------------------
  // Two-line purchase: A 10@1,000,000 (10%), B 5@2,000,000 (8%).
  // -------------------------------------------------------------------------
  it('two-line purchase → Dr 156 / Dr 1331 / Cr 331(vendor), balanced; on-hand + AP', async () => {
    const pid = await periodId(1);

    const beforeA = await onHand(smeId, matAId);
    const beforeB = await onHand(smeId, matBId);

    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/purchase-invoices`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: vendorId,
        invoiceDate: '2026-03-15',
        periodId: pid,
        vendorInvoiceNo: 'INV-A-001',
        nonCashPayment: true,
        description: 'HĐ mua hàng 2 dòng',
        lines: [
          { materialId: matAId, quantity: '10', unitCostMinor: '1000000', vatRuleType: 'vat_rate' },
          { materialId: matBId, quantity: '5', unitCostMinor: '2000000', vatRuleType: 'vat_rate_reduced' },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('posted');
    expect(res.body.subtotalMinor).toBe('20000000');
    expect(res.body.vatMinor).toBe('1800000');
    expect(res.body.totalMinor).toBe('21800000');
    expect(res.body.invoiceNo).toBe(1);
    expect(res.body.vendorInvoiceNo).toBe('INV-A-001');
    expect(res.body.nonCashPayment).toBe(true);

    const lines: Array<{ vatRatePct: number; vatMinor: string; lineCostMinor: string }> =
      res.body.lines;
    const lineA = lines.find((l) => l.vatRatePct === 10)!;
    const lineB = lines.find((l) => l.vatRatePct === 8)!;
    expect(lineA.lineCostMinor).toBe('10000000');
    expect(lineA.vatMinor).toBe('1000000');
    expect(lineB.lineCostMinor).toBe('10000000');
    expect(lineB.vatMinor).toBe('800000');

    // Journal: Dr 156 20,000,000 / Dr 1331 1,800,000 / Cr 331 21,800,000.
    const je = await request(app.getHttpServer())
      .get(`/journal-entries/${res.body.journalEntryId}`)
      .set('Cookie', adminCookie);
    expect(je.status).toBe(200);

    const acct156 = await accountId(smeId, '156');
    const acct1331 = await accountId(smeId, '1331');
    const acct331 = await accountId(smeId, '331');

    const jl: Array<{
      accountId: string;
      debitMinor: string;
      creditMinor: string;
      partnerId: string | null;
    }> = je.body.lines;

    const dr156 = jl.find((l) => l.accountId === acct156)!;
    const dr1331 = jl.find((l) => l.accountId === acct1331)!;
    const cr331 = jl.find((l) => l.accountId === acct331)!;

    expect(dr156.debitMinor).toBe('20000000');
    expect(dr156.creditMinor).toBe('0');
    expect(dr1331.debitMinor).toBe('1800000');
    expect(cr331.creditMinor).toBe('21800000');
    expect(cr331.partnerId).toBe(vendorId);

    const totDr = jl.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const totCr = jl.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(totDr).toBe(totCr);
    expect(totDr).toBe(21800000n);

    // Inventory: both materials' on-hand qty + value rose by the receipt.
    const afterA = await onHand(smeId, matAId);
    const afterB = await onHand(smeId, matBId);
    expect(afterA.qty - beforeA.qty).toBe(10n);
    expect(afterA.value - beforeA.value).toBe(10000000n);
    expect(afterB.qty - beforeB.qty).toBe(5n);
    expect(afterB.value - beforeB.value).toBe(10000000n);

    // AP for the vendor = total.
    expect(await apBalance(smeId, vendorId)).toBe(21800000n);
  });

  // -------------------------------------------------------------------------
  // All-exempt line → vat 0, NO 1331 line.
  // -------------------------------------------------------------------------
  it('all-exempt purchase → no 1331 line, Dr 156 = Cr 331', async () => {
    const pid = await periodId(1);
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/purchase-invoices`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: vendorId,
        invoiceDate: '2026-03-16',
        periodId: pid,
        lines: [
          { materialId: matAId, quantity: '1', unitCostMinor: '2000000', vatRuleType: 'vat_exempt' },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.vatMinor).toBe('0');
    expect(res.body.totalMinor).toBe('2000000');
    expect(res.body.invoiceNo).toBe(2);

    const je = await request(app.getHttpServer())
      .get(`/journal-entries/${res.body.journalEntryId}`)
      .set('Cookie', adminCookie);
    const acct1331 = await accountId(smeId, '1331');
    const jl: Array<{ accountId: string; debitMinor: string; creditMinor: string }> =
      je.body.lines;
    expect(jl.find((l) => l.accountId === acct1331)).toBeUndefined();
    expect(jl).toHaveLength(2); // 156 + 331 only
    const totDr = jl.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const totCr = jl.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(totDr).toBe(2000000n);
    expect(totCr).toBe(2000000n);
  });

  // -------------------------------------------------------------------------
  // 2027 purchase with vat_rate_reduced → 422 (8% window closed). Nothing persists.
  // -------------------------------------------------------------------------
  it('2027 purchase with vat_rate_reduced → 422, invoiceNo unaffected', async () => {
    const pid2027 = await periodId(1, 2027);

    const before = (await app.rawSql.unsafe(
      `SELECT COALESCE(MAX(invoice_no),0)::text AS m FROM purchase_invoices
       WHERE company_id='${smeId}' AND fiscal_year=2027`,
    )) as Array<{ m: string }>;

    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/purchase-invoices`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: vendorId,
        invoiceDate: '2027-01-02',
        periodId: pid2027,
        lines: [
          { materialId: matAId, quantity: '1', unitCostMinor: '1000000', vatRuleType: 'vat_rate_reduced' },
        ],
      });
    expect(res.status).toBe(422);

    const after = (await app.rawSql.unsafe(
      `SELECT COALESCE(MAX(invoice_no),0)::text AS m FROM purchase_invoices
       WHERE company_id='${smeId}' AND fiscal_year=2027`,
    )) as Array<{ m: string }>;
    expect(after[0]!.m).toBe(before[0]!.m);
  });

  // -------------------------------------------------------------------------
  // invoiceNo increments per (company, fiscalYear).
  // -------------------------------------------------------------------------
  it('invoiceNo increments per (company, fiscalYear)', async () => {
    const pid = await periodId(1);
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/purchase-invoices`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: vendorId,
        invoiceDate: '2026-03-18',
        periodId: pid,
        lines: [
          { materialId: matAId, quantity: '1', unitCostMinor: '1000000', vatRuleType: 'vat_rate' },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.invoiceNo).toBe(3); // 1 (two-line), 2 (exempt) precede.
  });

  // -------------------------------------------------------------------------
  // Cancel → journal reversed, inventory removed, AP back to zero, re-cancel 422.
  // -------------------------------------------------------------------------
  it('cancel reverses the entry + inventory; vendor AP back to zero', async () => {
    const pid = await periodId(1);
    // Fresh vendor + material so the AP / on-hand deltas are isolated.
    const v = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'V-CANCEL', name: 'NCC hủy', partnerType: 'vendor' });
    const cancelVendor = v.body.id as string;

    const m = await request(app.getHttpServer())
      .post(`/companies/${smeId}/materials`)
      .set('Cookie', adminCookie)
      .send({ code: 'M-CANCEL', name: 'VT hủy' });
    const cancelMat = m.body.id as string;

    const before = await onHand(smeId, cancelMat); // {0,0}

    const inv = await request(app.getHttpServer())
      .post(`/companies/${smeId}/purchase-invoices`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: cancelVendor,
        invoiceDate: '2026-03-19',
        periodId: pid,
        lines: [
          { materialId: cancelMat, quantity: '4', unitCostMinor: '1500000', vatRuleType: 'vat_rate' },
        ],
      });
    expect(inv.status).toBe(201);
    // subtotal 6,000,000; vat 600,000; total 6,600,000.
    expect(inv.body.totalMinor).toBe('6600000');
    expect(await apBalance(smeId, cancelVendor)).toBe(6600000n);

    const afterPost = await onHand(smeId, cancelMat);
    expect(afterPost.qty - before.qty).toBe(4n);
    expect(afterPost.value - before.value).toBe(6000000n);

    const cancel = await request(app.getHttpServer())
      .post(`/purchase-invoices/${inv.body.id}/cancel`)
      .set('Cookie', adminCookie);
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('cancelled');

    const je = await request(app.getHttpServer())
      .get(`/journal-entries/${inv.body.journalEntryId}`)
      .set('Cookie', adminCookie);
    expect(je.body.status).toBe('reversed');

    // AP back to zero, inventory back to before.
    expect(await apBalance(smeId, cancelVendor)).toBe(0n);
    const afterCancel = await onHand(smeId, cancelMat);
    expect(afterCancel.qty).toBe(before.qty);
    expect(afterCancel.value).toBe(before.value);

    // Re-cancel → 422.
    const again = await request(app.getHttpServer())
      .post(`/purchase-invoices/${inv.body.id}/cancel`)
      .set('Cookie', adminCookie);
    expect(again.status).toBe(422);
  });

  // -------------------------------------------------------------------------
  // Cross-company vendor → 422.
  // -------------------------------------------------------------------------
  it('vendor from another company → 422', async () => {
    const pid = await periodId(1);
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/purchase-invoices`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: hkdVendorId,
        invoiceDate: '2026-03-20',
        periodId: pid,
        lines: [
          { materialId: matAId, quantity: '1', unitCostMinor: '1000000', vatRuleType: 'vat_rate' },
        ],
      });
    expect(res.status).toBe(422);
  });

  // -------------------------------------------------------------------------
  // Cross-company material → 422.
  // -------------------------------------------------------------------------
  it('material from another company → 422', async () => {
    const pid = await periodId(1);
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/purchase-invoices`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: vendorId,
        invoiceDate: '2026-03-21',
        periodId: pid,
        lines: [
          { materialId: hkdMatId, quantity: '1', unitCostMinor: '1000000', vatRuleType: 'vat_rate' },
        ],
      });
    expect(res.status).toBe(422);
  });

  // -------------------------------------------------------------------------
  // GET unknown invoice → 404.
  // -------------------------------------------------------------------------
  it('GET unknown invoice → 404', async () => {
    const res = await request(app.getHttpServer())
      .get('/purchase-invoices/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });
});
