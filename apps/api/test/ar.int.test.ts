/**
 * Integration tests for the AR sub-ledger (Phase 2a A7).
 *
 * Proves:
 *   - GET /companies/:id/ar?fiscalYear=&through= (arByCustomer)
 *       - lists each customer's 131 debit/credit/balance
 *       - the `total` reconciles exactly to the trial-balance 131 balance
 *   - GET /companies/:id/ar/:partnerId?fiscalYear=&through= (arForCustomer)
 *       - movements in chronological order with correct running balance
 *       - closingBalance = T1 − R (invoice minus partial receipt)
 *   - Two customers are independent (no cross-contamination)
 *   - 404 for unknown/inaccessible partner
 *   - 401 for unauthenticated
 *
 * Scenario:
 *   - Customer 1 (C001): invoice T1 = 10,000,000 VND + 10% VAT = 11,000,000; partial receipt R = 3,000,000
 *   - Customer 2 (C002): invoice T2 = 5,000,000 VND + 10% VAT = 5,500,000; no receipt
 *   - arByCustomer total = (11,000,000 − 3,000,000) + 5,500,000 = 13,500,000
 *   - trial-balance 131 balance MUST equal 13,500,000
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
let customerId1: string;  // C001
let customerId2: string;  // C002
let periodId1: string;    // FY2026 period 1

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

/** Post a sales invoice via the API and return the body. */
async function postInvoice(
  partnerId: string,
  unitPriceMinor: string,
  invoiceDate: string,
): Promise<{ id: string; totalMinor: string }> {
  const res = await request(app.getHttpServer())
    .post(`/companies/${smeId}/sales-invoices`)
    .set('Cookie', adminCookie)
    .send({
      partnerId,
      invoiceDate,
      periodId: periodId1,
      lines: [
        {
          description: 'Hàng hóa 10%',
          quantity: '1',
          unitPriceMinor,
          vatRuleType: 'vat_rate',
        },
      ],
    });
  if (res.status !== 201) {
    throw new Error(`postInvoice failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { id: res.body.id as string, totalMinor: res.body.totalMinor as string };
}

/** Post a customer receipt via the API. */
async function postReceipt(
  partnerId: string,
  amountMinor: string,
  receiptDate: string,
): Promise<void> {
  const res = await request(app.getHttpServer())
    .post(`/companies/${smeId}/customer-receipts`)
    .set('Cookie', adminCookie)
    .send({
      partnerId,
      receiptDate,
      periodId: periodId1,
      amountMinor,
      settlementAccountCode: '111',
    });
  if (res.status !== 201) {
    throw new Error(`postReceipt failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

maybe('AR sub-ledger — arByCustomer + arForCustomer', () => {
  // Scenario amounts (bigint for exactness in test assertions):
  // T1: net=10,000,000; vat=1,000,000; total=11,000,000  (Dr 131 for C001)
  // R:  receipt=3,000,000                                  (Cr 131 for C001)
  // T2: net=5,000,000;  vat=500,000;   total=5,500,000   (Dr 131 for C002)
  // Expected AR:
  //   C001: debit=11,000,000  credit=3,000,000  balance=8,000,000
  //   C002: debit=5,500,000   credit=0           balance=5,500,000
  //   total = 8,000,000 + 5,500,000 = 13,500,000
  const T1_TOTAL = 11_000_000n;
  const R_AMOUNT = 3_000_000n;
  const T2_TOTAL = 5_500_000n;
  const C001_BALANCE = T1_TOTAL - R_AMOUNT; // 8,000,000
  const C002_BALANCE = T2_TOTAL;             // 5,500,000
  const AR_TOTAL = C001_BALANCE + C002_BALANCE; // 13,500,000

  beforeAll(async () => {
    app = await makeApp();
    ({ adminCookie, smeId } = await seedTwoCompaniesAndUsers(app));

    await seedVatRules();

    // Provision CoA for the SME (creates account 131, 511, 3331, 111, etc.).
    const prov = await request(app.getHttpServer())
      .post(`/companies/${smeId}/coa/provision`)
      .set('Cookie', adminCookie);
    expect(prov.status).toBe(200);

    // Generate FY2026 periods.
    const fy = await request(app.getHttpServer())
      .post(`/companies/${smeId}/fiscal-years`)
      .set('Cookie', adminCookie)
      .send({ fiscalYear: 2026 });
    expect(fy.status).toBe(200);

    periodId1 = await getPeriodId(1);

    // Create two customers.
    const c1 = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'C001', name: 'Khách hàng Alpha', partnerType: 'customer' });
    expect(c1.status).toBe(201);
    customerId1 = c1.body.id as string;

    const c2 = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'C002', name: 'Khách hàng Beta', partnerType: 'customer' });
    expect(c2.status).toBe(201);
    customerId2 = c2.body.id as string;

    // Post invoice T1 to customer 1 (net 10,000,000 → total 11,000,000 with 10% VAT).
    await postInvoice(customerId1, '10000000', '2026-03-01');

    // Post partial receipt R for customer 1 (3,000,000).
    await postReceipt(customerId1, '3000000', '2026-03-15');

    // Post invoice T2 to customer 2 (net 5,000,000 → total 5,500,000 with 10% VAT).
    await postInvoice(customerId2, '5000000', '2026-03-20');
  });

  afterAll(async () => {
    await closeApp(app);
  });

  // ---------------------------------------------------------------------------
  // arByCustomer — summary by customer
  // ---------------------------------------------------------------------------

  it('arByCustomer: lists C001 and C002 with correct debit/credit/balance', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ar?fiscalYear=2026&through=12`)
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

    // Find C001 and C002 rows.
    const row1 = body.rows.find((r) => r.partnerId === customerId1);
    const row2 = body.rows.find((r) => r.partnerId === customerId2);

    expect(row1).toBeDefined();
    expect(row2).toBeDefined();

    // C001: Dr 131 = 11,000,000 (invoice); Cr 131 = 3,000,000 (receipt).
    expect(BigInt(row1!.debit)).toBe(T1_TOTAL);
    expect(BigInt(row1!.credit)).toBe(R_AMOUNT);
    expect(BigInt(row1!.balance)).toBe(C001_BALANCE);
    expect(row1!.partnerCode).toBe('C001');
    expect(row1!.partnerName).toBe('Khách hàng Alpha');

    // C002: Dr 131 = 5,500,000 (invoice); no receipt.
    expect(BigInt(row2!.debit)).toBe(T2_TOTAL);
    expect(BigInt(row2!.credit)).toBe(0n);
    expect(BigInt(row2!.balance)).toBe(C002_BALANCE);
    expect(row2!.partnerCode).toBe('C002');
    expect(row2!.partnerName).toBe('Khách hàng Beta');
  });

  it('arByCustomer: total equals (T1−R)+T2', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ar?fiscalYear=2026&through=12`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    const { total } = res.body as { total: string };
    expect(BigInt(total)).toBe(AR_TOTAL); // 13,500,000
  });

  // ---------------------------------------------------------------------------
  // Reconciliation: AR total == trial-balance 131 balance
  // ---------------------------------------------------------------------------

  it('AR total reconciles to trial-balance 131 balance', async () => {
    // Fetch the AR sub-ledger total.
    const arRes = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ar?fiscalYear=2026&through=12`)
      .set('Cookie', adminCookie);
    expect(arRes.status).toBe(200);
    const arTotal = BigInt((arRes.body as { total: string }).total);

    // Fetch the trial balance and find the 131 row.
    const tbRes = await request(app.getHttpServer())
      .get(`/companies/${smeId}/trial-balance?fiscalYear=2026&through=12`)
      .set('Cookie', adminCookie);
    expect(tbRes.status).toBe(200);

    const tbRows = (tbRes.body as {
      rows: Array<{ code: string; balance: string }>;
    }).rows;
    const row131 = tbRows.find((r) => r.code === '131');
    expect(row131).toBeDefined();

    const tb131Balance = BigInt(row131!.balance);

    // THE CORE RECONCILIATION ASSERTION: AR total must equal TB 131 balance.
    expect(arTotal).toBe(tb131Balance);
    // Both should be 13,500,000.
    expect(arTotal).toBe(AR_TOTAL);
  });

  // ---------------------------------------------------------------------------
  // arForCustomer — movements with running balance
  // ---------------------------------------------------------------------------

  it('arForCustomer C001: invoice then receipt, correct running balance', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ar/${customerId1}?fiscalYear=2026&through=12`)
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

    expect(body.partner.id).toBe(customerId1);
    expect(body.partner.code).toBe('C001');
    expect(body.openingBalance).toBe('0');

    // Should have 2 movements: invoice (Dr 11,000,000) then receipt (Cr 3,000,000).
    expect(body.movements).toHaveLength(2);

    const [invoiceMovement, receiptMovement] = body.movements;

    // Invoice movement: Dr 11,000,000, Cr 0, running balance = 11,000,000.
    expect(BigInt(invoiceMovement!.debit)).toBe(T1_TOTAL);
    expect(BigInt(invoiceMovement!.credit)).toBe(0n);
    expect(BigInt(invoiceMovement!.runningBalance)).toBe(T1_TOTAL);

    // Receipt movement: Dr 0, Cr 3,000,000, running balance = 8,000,000.
    expect(BigInt(receiptMovement!.debit)).toBe(0n);
    expect(BigInt(receiptMovement!.credit)).toBe(R_AMOUNT);
    expect(BigInt(receiptMovement!.runningBalance)).toBe(C001_BALANCE);

    // closingBalance = T1 − R = 8,000,000.
    expect(BigInt(body.closingBalance)).toBe(C001_BALANCE);
  });

  it('arForCustomer C002: only the invoice movement, closingBalance = T2', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ar/${customerId2}?fiscalYear=2026&through=12`)
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
    expect(BigInt(invoiceMovement!.debit)).toBe(T2_TOTAL);
    expect(BigInt(invoiceMovement!.credit)).toBe(0n);
    expect(BigInt(invoiceMovement!.runningBalance)).toBe(T2_TOTAL);

    expect(BigInt(body.closingBalance)).toBe(T2_TOTAL);
  });

  it('two customers are independent: C001 movements do not include C002 activity', async () => {
    const res1 = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ar/${customerId1}?fiscalYear=2026&through=12`)
      .set('Cookie', adminCookie);
    const res2 = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ar/${customerId2}?fiscalYear=2026&through=12`)
      .set('Cookie', adminCookie);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // C001 has 2 movements (invoice + receipt); C002 has 1 (invoice only).
    const m1 = (res1.body as { movements: unknown[] }).movements;
    const m2 = (res2.body as { movements: unknown[] }).movements;
    expect(m1).toHaveLength(2);
    expect(m2).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // Default through=12
  // ---------------------------------------------------------------------------

  it('arByCustomer: through defaults to 12 when omitted', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ar?fiscalYear=2026`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect((res.body as { throughPeriodNo: number }).throughPeriodNo).toBe(12);
  });

  // ---------------------------------------------------------------------------
  // 404 for unknown partner
  // ---------------------------------------------------------------------------

  it('arForCustomer: 404 for unknown/inaccessible partner', async () => {
    const res = await request(app.getHttpServer())
      .get(
        `/companies/${smeId}/ar/00000000-0000-0000-0000-000000000000?fiscalYear=2026`,
      )
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // 401 for unauthenticated requests
  // ---------------------------------------------------------------------------

  it('arByCustomer: 401 when not authenticated', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ar?fiscalYear=2026`);
    expect(res.status).toBe(401);
  });

  it('arForCustomer: 401 when not authenticated', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ar/${customerId1}?fiscalYear=2026`);
    expect(res.status).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // arByCustomer for a period with no 131 activity → empty rows, total = '0'
  // ---------------------------------------------------------------------------

  it('arByCustomer: no activity for FY2025 → empty rows and total=0', async () => {
    // No FY2025 periods were created, but arByCustomer on a year with no matching
    // entries should return empty rows (not 404).
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ar?fiscalYear=2025&through=12`)
      .set('Cookie', adminCookie);
    // 404 if account 131 not provisioned would be wrong here — it IS provisioned.
    // We expect 200 with empty rows.
    expect(res.status).toBe(200);
    const body = res.body as { rows: unknown[]; total: string };
    expect(body.rows).toHaveLength(0);
    expect(BigInt(body.total)).toBe(0n);
  });
});
