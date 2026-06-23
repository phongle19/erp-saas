/**
 * Integration tests for the AP sub-ledger (Phase 2b B7).
 *
 * Proves:
 *   - GET /companies/:id/ap?fiscalYear=&through= (apByVendor)
 *       - lists each vendor's 331 debit/credit/balance (credit-positive)
 *       - the `total` reconciles exactly to the trial-balance 331 balance
 *   - GET /companies/:id/ap/:partnerId?fiscalYear=&through= (apForVendor)
 *       - movements in chronological order with correct running balance (credit-positive)
 *       - closingBalance = T − R (invoice minus partial payment)
 *   - Inventory valuation reconciles to trial-balance 156 balance (key MM property)
 *   - Two vendors are independent (no cross-contamination)
 *   - 404 for unknown/inaccessible partner
 *   - 401 for unauthenticated
 *
 * Scenario:
 *   - Vendor 1 (V001): purchase invoice T = 10,000,000 VND subtotal + 10% VAT = 11,000,000 total
 *       → Dr 156 10,000,000 / Dr 1331 1,000,000 / Cr 331(V001) 11,000,000
 *   - Partial payment R = 3,000,000 via manual journal Dr 331(V001) / Cr 111
 *       → Cr 331 3,000,000 (settles part of payable)
 *   - Vendor 1 AP balance = T − R = 11,000,000 − 3,000,000 = 8,000,000 (credit-positive)
 *   - Vendor 2 (V002): purchase invoice T2 = 5,000,000 subtotal + 10% VAT = 5,500,000 total
 *       → no payment
 *   - apByVendor total = 8,000,000 + 5,500,000 = 13,500,000 (trial-balance 331 balance)
 *   - inventory valuation (156 account) = 10,000,000 (V001 subtotal) + 5,000,000 (V002 subtotal)
 *       = 15,000,000, which must equal trial-balance 156 balance
 *
 * DB-backed, runs as the NOBYPASSRLS `erp` role (same setup as all other int tests).
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
let vendorId1: string; // V001
let vendorId2: string; // V002
let matId: string;     // single material for V001 invoice
let mat2Id: string;    // material for V002 invoice
let periodId1: string; // FY2026 period 1

/** Fetch the SME's open period for a given periodNo in FY2026. */
async function getPeriodId(periodNo: number, fy = 2026): Promise<string> {
  const res = await request(app.getHttpServer())
    .get(`/companies/${smeId}/periods?fiscalYear=${fy}`)
    .set('Cookie', adminCookie);
  const p = res.body.find((x: { periodNo: number }) => x.periodNo === periodNo);
  if (!p) throw new Error(`period ${periodNo}/${fy} not found`);
  return p.id as string;
}

/** Seed the VAT tax_rules (truncateAll clears the table each run). */
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

/** Post a purchase invoice via the API. Returns the response body. */
async function postPurchaseInvoice(
  partnerId: string,
  materialId: string,
  quantity: string,
  unitCostMinor: string,
  invoiceDate: string,
): Promise<{ id: string; totalMinor: string; subtotalMinor: string }> {
  const res = await request(app.getHttpServer())
    .post(`/companies/${smeId}/purchase-invoices`)
    .set('Cookie', adminCookie)
    .send({
      partnerId,
      invoiceDate,
      periodId: periodId1,
      vendorInvoiceNo: `INV-${Date.now()}`,
      nonCashPayment: true,
      description: 'Test purchase',
      lines: [
        {
          materialId,
          quantity,
          unitCostMinor,
          vatRuleType: 'vat_rate', // 10%
        },
      ],
    });
  if (res.status !== 201) {
    throw new Error(`postPurchaseInvoice failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return {
    id: res.body.id as string,
    totalMinor: res.body.totalMinor as string,
    subtotalMinor: res.body.subtotalMinor as string,
  };
}

/**
 * Post a manual Dr 331 / Cr 111 journal entry to simulate a partial vendor payment.
 * (B8 vendor-payments service not yet implemented; use PostingEngine directly via API.)
 */
async function postManualPayment(
  partnerId: string,
  amountMinor: string,
  paymentDate: string,
): Promise<void> {
  const res = await request(app.getHttpServer())
    .post('/journal-entries')
    .set('Cookie', adminCookie)
    .send({
      companyId: smeId,
      periodId: periodId1,
      entryDate: paymentDate,
      description: `Trả tiền nhà cung cấp ${amountMinor}`,
      lines: [
        {
          // Dr 331 (reduce payable)
          accountCode: '331',
          debitMinor: amountMinor,
          creditMinor: '0',
          partnerId,
        },
        {
          // Cr 111 (cash out)
          accountCode: '111',
          debitMinor: '0',
          creditMinor: amountMinor,
        },
      ],
    });
  if (res.status !== 201) {
    throw new Error(`postManualPayment failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

maybe('AP sub-ledger — apByVendor + apForVendor + reconciliation', () => {
  // Scenario amounts (bigint for exactness in assertions):
  // V001 invoice: subtotal=10,000,000; vat=1,000,000; total=11,000,000 → Cr 331 V001
  // V001 payment: 3,000,000                                              → Dr 331 V001
  // V001 AP balance (credit-positive) = 11,000,000 − 3,000,000 = 8,000,000
  //
  // V002 invoice: subtotal=5,000,000; vat=500,000; total=5,500,000 → Cr 331 V002
  // V002 AP balance = 5,500,000
  //
  // AP total = 8,000,000 + 5,500,000 = 13,500,000 (== TB 331 balance)
  //
  // Inventory (156): V001 receipt 10,000,000 + V002 receipt 5,000,000 = 15,000,000
  // (== TB 156 balance — the key MM correctness property)
  const T1_SUBTOTAL = 10_000_000n;
  const T1_VAT = 1_000_000n;
  const T1_TOTAL = T1_SUBTOTAL + T1_VAT; // 11,000,000
  const R_AMOUNT = 3_000_000n;
  const T2_SUBTOTAL = 5_000_000n;
  const T2_VAT = 500_000n;
  const T2_TOTAL = T2_SUBTOTAL + T2_VAT; // 5,500,000
  const V001_AP_BALANCE = T1_TOTAL - R_AMOUNT;  // 8,000,000 (credit-positive)
  const V002_AP_BALANCE = T2_TOTAL;              // 5,500,000
  const AP_TOTAL = V001_AP_BALANCE + V002_AP_BALANCE; // 13,500,000
  const INV_156_TOTAL = T1_SUBTOTAL + T2_SUBTOTAL;    // 15,000,000

  beforeAll(async () => {
    app = await makeApp();
    ({ adminCookie, smeId, hkdId } = await seedTwoCompaniesAndUsers(app));

    await seedVatRules();

    // Provision CoA for the SME (creates accounts 331, 156, 1331, 111, etc.).
    const prov = await request(app.getHttpServer())
      .post(`/companies/${smeId}/coa/provision`)
      .set('Cookie', adminCookie);
    expect(prov.status).toBe(200);

    // Also provision CoA for the other company (cross-company tests).
    const prov2 = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/coa/provision`)
      .set('Cookie', adminCookie);
    expect(prov2.status).toBe(200);

    // Generate FY2026 periods.
    const fy = await request(app.getHttpServer())
      .post(`/companies/${smeId}/fiscal-years`)
      .set('Cookie', adminCookie)
      .send({ fiscalYear: 2026 });
    expect(fy.status).toBe(200);

    periodId1 = await getPeriodId(1);

    // Create two vendors for the SME.
    const v1 = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'V001', name: 'Nhà cung cấp Alpha', partnerType: 'vendor' });
    expect(v1.status).toBe(201);
    vendorId1 = v1.body.id as string;

    const v2 = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'V002', name: 'Nhà cung cấp Beta', partnerType: 'vendor' });
    expect(v2.status).toBe(201);
    vendorId2 = v2.body.id as string;

    // Create materials for both vendors' purchases.
    const m1 = await request(app.getHttpServer())
      .post(`/companies/${smeId}/materials`)
      .set('Cookie', adminCookie)
      .send({ code: 'MAT-A', name: 'Vật tư A' });
    expect(m1.status).toBe(201);
    matId = m1.body.id as string;

    const m2 = await request(app.getHttpServer())
      .post(`/companies/${smeId}/materials`)
      .set('Cookie', adminCookie)
      .send({ code: 'MAT-B', name: 'Vật tư B' });
    expect(m2.status).toBe(201);
    mat2Id = m2.body.id as string;

    // Post purchase invoice T1 for vendor 1: 10 units @ 1,000,000 = 10,000,000 subtotal.
    // (10% VAT → 11,000,000 total; Cr 331(V001) 11,000,000; Dr 156 10,000,000; Dr 1331 1,000,000)
    await postPurchaseInvoice(vendorId1, matId, '10', '1000000', '2026-03-01');

    // Post partial payment R for vendor 1: 3,000,000 (Dr 331 V001 / Cr 111).
    await postManualPayment(vendorId1, '3000000', '2026-03-15');

    // Post purchase invoice T2 for vendor 2: 5 units @ 1,000,000 = 5,000,000 subtotal.
    // (10% VAT → 5,500,000 total; Cr 331(V002) 5,500,000; Dr 156 5,000,000; Dr 1331 500,000)
    await postPurchaseInvoice(vendorId2, mat2Id, '5', '1000000', '2026-03-20');
  });

  afterAll(async () => {
    await closeApp(app);
  });

  // ---------------------------------------------------------------------------
  // apByVendor — summary by vendor
  // ---------------------------------------------------------------------------

  it('apByVendor: lists V001 and V002 with correct debit/credit/balance (credit-positive)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ap?fiscalYear=2026&through=12`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    const body = res.body as {
      fiscalYear: number;
      throughPeriodNo: number;
      rows: Array<{
        partnerId: string | null;
        partnerCode: string | null;
        partnerName: string | null;
        debit: string;
        credit: string;
        balance: string;
      }>;
      total: string;
    };

    expect(body.fiscalYear).toBe(2026);
    expect(body.throughPeriodNo).toBe(12);

    // Find V001 and V002 rows.
    const row1 = body.rows.find((r) => r.partnerId === vendorId1);
    const row2 = body.rows.find((r) => r.partnerId === vendorId2);

    expect(row1).toBeDefined();
    expect(row2).toBeDefined();

    // V001: Cr 331 = 11,000,000 (invoice); Dr 331 = 3,000,000 (payment).
    // AP balance = credit − debit = 8,000,000 (credit-positive).
    expect(BigInt(row1!.credit)).toBe(T1_TOTAL);      // 11,000,000
    expect(BigInt(row1!.debit)).toBe(R_AMOUNT);        // 3,000,000
    expect(BigInt(row1!.balance)).toBe(V001_AP_BALANCE); // 8,000,000
    expect(row1!.partnerCode).toBe('V001');
    expect(row1!.partnerName).toBe('Nhà cung cấp Alpha');

    // V002: Cr 331 = 5,500,000 (invoice); no payment.
    // AP balance = 5,500,000 (credit-positive).
    expect(BigInt(row2!.credit)).toBe(T2_TOTAL);       // 5,500,000
    expect(BigInt(row2!.debit)).toBe(0n);
    expect(BigInt(row2!.balance)).toBe(V002_AP_BALANCE); // 5,500,000
    expect(row2!.partnerCode).toBe('V002');
    expect(row2!.partnerName).toBe('Nhà cung cấp Beta');
  });

  it('apByVendor: total equals (T1−R)+T2 = 13,500,000', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ap?fiscalYear=2026&through=12`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    const { total } = res.body as { total: string };
    expect(BigInt(total)).toBe(AP_TOTAL); // 13,500,000
  });

  // ---------------------------------------------------------------------------
  // Reconciliation 1: AP total == trial-balance 331 balance (core AP assertion)
  // ---------------------------------------------------------------------------

  it('AP total reconciles to trial-balance 331 balance', async () => {
    // Fetch the AP sub-ledger total.
    const apRes = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ap?fiscalYear=2026&through=12`)
      .set('Cookie', adminCookie);
    expect(apRes.status).toBe(200);
    const apTotal = BigInt((apRes.body as { total: string }).total);

    // Fetch the trial balance and find the 331 row.
    const tbRes = await request(app.getHttpServer())
      .get(`/companies/${smeId}/trial-balance?fiscalYear=2026&through=12`)
      .set('Cookie', adminCookie);
    expect(tbRes.status).toBe(200);

    const tbRows = (tbRes.body as {
      rows: Array<{ code: string; balance: string }>;
    }).rows;
    const row331 = tbRows.find((r) => r.code === '331');
    expect(row331).toBeDefined();

    // 331 is a liability (credit-normal). The LedgerService trial balance computes
    // balance = debit − credit universally, so the 331 row balance is NEGATIVE
    // for a normal payable position: balance = 3,000,000 − 16,500,000 = −13,500,000.
    // The AP sub-ledger total uses credit − debit (open payable, positive), so:
    //   apTotal = −(tb331Balance)
    const tb331Balance = BigInt(row331!.balance);

    // THE CORE AP RECONCILIATION: AP total must equal the absolute open payable on 331.
    // tb331Balance is negative for a credit-heavy (payable) account; negate to get
    // the credit-positive open payable.
    expect(apTotal).toBe(-tb331Balance);
    // AP sub-ledger total should be 13,500,000.
    expect(apTotal).toBe(AP_TOTAL);
  });

  // ---------------------------------------------------------------------------
  // Reconciliation 2: inventory valuation == trial-balance 156 balance (MM property)
  // ---------------------------------------------------------------------------

  it('inventory valuation totalValue reconciles to trial-balance 156 balance', async () => {
    // Fetch the inventory valuation report.
    const invRes = await request(app.getHttpServer())
      .get(`/companies/${smeId}/inventory`)
      .set('Cookie', adminCookie);
    expect(invRes.status).toBe(200);
    const invTotal = BigInt((invRes.body as { totalValue: string }).totalValue);

    // Fetch the trial balance and find the 156 row.
    const tbRes = await request(app.getHttpServer())
      .get(`/companies/${smeId}/trial-balance?fiscalYear=2026&through=12`)
      .set('Cookie', adminCookie);
    expect(tbRes.status).toBe(200);

    const tbRows = (tbRes.body as {
      rows: Array<{ code: string; balance: string }>;
    }).rows;
    const row156 = tbRows.find((r) => r.code === '156');
    expect(row156).toBeDefined();

    // 156 is an asset (debit-normal). Its TB balance is the debit-side balance.
    // The inventory valuation total (Σ latest balance value) must equal this.
    const tb156Balance = BigInt(row156!.balance);

    // THE INVENTORY RECONCILIATION: valuation total must equal TB 156 balance.
    expect(invTotal).toBe(tb156Balance);
    // Both should be 15,000,000 (V001 10,000,000 + V002 5,000,000).
    expect(invTotal).toBe(INV_156_TOTAL);
  });

  // ---------------------------------------------------------------------------
  // apForVendor — movements with running balance (credit-positive)
  // ---------------------------------------------------------------------------

  it('apForVendor V001: invoice (Cr) then payment (Dr), correct running balance', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ap/${vendorId1}?fiscalYear=2026&through=12`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    const body = res.body as {
      partner: { id: string; code: string; name: string };
      openingBalance: string;
      movements: Array<{
        entryNo: number;
        entryDate: string;
        description: string;
        debit: string;
        credit: string;
        runningBalance: string;
      }>;
      closingBalance: string;
    };

    expect(body.partner.id).toBe(vendorId1);
    expect(body.partner.code).toBe('V001');
    expect(body.openingBalance).toBe('0');

    // Should have 2 movements: invoice (Cr 11,000,000) then payment (Dr 3,000,000).
    expect(body.movements).toHaveLength(2);

    const [invoiceMovement, paymentMovement] = body.movements;

    // Invoice movement: Cr 11,000,000, Dr 0, running balance = 11,000,000 (credit-positive).
    expect(BigInt(invoiceMovement!.credit)).toBe(T1_TOTAL);   // 11,000,000
    expect(BigInt(invoiceMovement!.debit)).toBe(0n);
    expect(BigInt(invoiceMovement!.runningBalance)).toBe(T1_TOTAL); // 11,000,000

    // Payment movement: Dr 3,000,000, Cr 0, running balance = 8,000,000.
    expect(BigInt(paymentMovement!.debit)).toBe(R_AMOUNT);    // 3,000,000
    expect(BigInt(paymentMovement!.credit)).toBe(0n);
    expect(BigInt(paymentMovement!.runningBalance)).toBe(V001_AP_BALANCE); // 8,000,000

    // closingBalance = T1 − R = 8,000,000 (credit-positive open payable).
    expect(BigInt(body.closingBalance)).toBe(V001_AP_BALANCE);
  });

  it('apForVendor V002: only the invoice movement, closingBalance = T2', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ap/${vendorId2}?fiscalYear=2026&through=12`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    const body = res.body as {
      openingBalance: string;
      movements: Array<{ debit: string; credit: string; runningBalance: string }>;
      closingBalance: string;
    };

    expect(body.openingBalance).toBe('0');
    expect(body.movements).toHaveLength(1);

    const [invoiceMovement] = body.movements;
    expect(BigInt(invoiceMovement!.credit)).toBe(T2_TOTAL);       // 5,500,000
    expect(BigInt(invoiceMovement!.debit)).toBe(0n);
    expect(BigInt(invoiceMovement!.runningBalance)).toBe(T2_TOTAL); // 5,500,000

    expect(BigInt(body.closingBalance)).toBe(T2_TOTAL);
  });

  it('two vendors are independent: V001 movements do not include V002 activity', async () => {
    const res1 = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ap/${vendorId1}?fiscalYear=2026&through=12`)
      .set('Cookie', adminCookie);
    const res2 = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ap/${vendorId2}?fiscalYear=2026&through=12`)
      .set('Cookie', adminCookie);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // V001 has 2 movements (invoice + payment); V002 has 1 (invoice only).
    const m1 = (res1.body as { movements: unknown[] }).movements;
    const m2 = (res2.body as { movements: unknown[] }).movements;
    expect(m1).toHaveLength(2);
    expect(m2).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // Default through=12
  // ---------------------------------------------------------------------------

  it('apByVendor: through defaults to 12 when omitted', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ap?fiscalYear=2026`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect((res.body as { throughPeriodNo: number }).throughPeriodNo).toBe(12);
  });

  // ---------------------------------------------------------------------------
  // 404 for unknown partner
  // ---------------------------------------------------------------------------

  it('apForVendor: 404 for unknown/inaccessible partner', async () => {
    const res = await request(app.getHttpServer())
      .get(
        `/companies/${smeId}/ap/00000000-0000-0000-0000-000000000000?fiscalYear=2026`,
      )
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // 401 for unauthenticated requests
  // ---------------------------------------------------------------------------

  it('apByVendor: 401 when not authenticated', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ap?fiscalYear=2026`);
    expect(res.status).toBe(401);
  });

  it('apForVendor: 401 when not authenticated', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ap/${vendorId1}?fiscalYear=2026`);
    expect(res.status).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // apByVendor for a period with no 331 activity → empty rows, total = '0'
  // ---------------------------------------------------------------------------

  it('apByVendor: no activity for FY2025 → empty rows and total=0', async () => {
    // No FY2025 periods were created, but apByVendor on a year with no matching
    // entries should return empty rows (not 404 — account 331 IS provisioned).
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ap?fiscalYear=2025&through=12`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const body = res.body as { rows: unknown[]; total: string };
    expect(body.rows).toHaveLength(0);
    expect(BigInt(body.total)).toBe(0n);
  });
});
