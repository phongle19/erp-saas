/**
 * Integration tests for customer receipts (Phase 2a A6):
 *   - POST /companies/:id/customer-receipts  (createAndPost)
 *   - GET  /customer-receipts/:id
 *   - POST /customer-receipts/:id/cancel
 *
 * DB-backed, runs as the NOBYPASSRLS `erp` role. The P4 double-entry +
 * immutability triggers are in force. Proves:
 *   - Dr 111 / Cr 131 (with partnerId) posting settles AR correctly,
 *   - Dr 112 / Cr 131 posting (bank settlement) also works,
 *   - AR balance (Σ 131 lines by partnerId) = invoice total − receipt amount,
 *   - cancel reverses the entry; AR returns to invoice total,
 *   - re-cancel → 422 (already cancelled),
 *   - receiptNo increments per (company, fiscalYear),
 *   - cross-company partnerId → 422,
 *   - unauthenticated → 401,
 *   - access to another company → 403,
 *   - amountMinor ≤ 0 → 400 (Zod).
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
let customerId: string;
let hkdCustomerId: string;

/** Fetch the SME's open period for a given periodNo in FY2026. */
async function periodId(periodNo: number, fy = 2026): Promise<string> {
  const res = await request(app.getHttpServer())
    .get(`/companies/${smeId}/periods?fiscalYear=${fy}`)
    .set('Cookie', adminCookie);
  const p = res.body.find((x: { periodNo: number }) => x.periodNo === periodNo);
  if (!p) throw new Error(`period ${periodNo}/${fy} not found`);
  return p.id as string;
}

/** Seed the five VAT tax_rules. */
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

/**
 * Run a query inside an admin-context tx (FORCE RLS satisfied via GUCs).
 * Mirrors the adminQuery helper in sales-invoice.int.test.ts.
 */
async function adminQuery<T>(
  companyId: string,
  sqlText: string,
): Promise<T[]> {
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

/** Account id for an account code under a company (admin-context). */
async function accountId(companyId: string, code: string): Promise<string> {
  const rows = await adminQuery<{ id: string }>(
    companyId,
    `SELECT id FROM chart_of_accounts WHERE company_id = '${companyId}' AND code = '${code}'`,
  );
  if (!rows[0]) throw new Error(`account ${code} not found for company ${companyId}`);
  return rows[0].id;
}

/**
 * AR balance = Σ (debit_minor − credit_minor) on account 131 for a given
 * partnerId (admin GUC tx so FORCE RLS is satisfied).
 */
async function arBalance(companyId: string, partnerId: string): Promise<bigint> {
  const acct131 = await accountId(companyId, '131');
  const rows = await adminQuery<{ bal: string }>(
    companyId,
    `SELECT COALESCE(SUM(debit_minor - credit_minor),0)::text AS bal
       FROM journal_lines
       WHERE company_id = '${companyId}' AND account_id = '${acct131}'
         AND partner_id = '${partnerId}'`,
  );
  return BigInt(rows[0]!.bal);
}

/** Post a sales invoice for companyId / partnerId and return its body. */
async function postInvoice(
  companyId: string,
  partnerId: string,
  periodIdVal: string,
  amountMinor: string,
) {
  const res = await request(app.getHttpServer())
    .post(`/companies/${companyId}/sales-invoices`)
    .set('Cookie', adminCookie)
    .send({
      partnerId,
      invoiceDate: '2026-03-01',
      periodId: periodIdVal,
      lines: [
        {
          description: 'Bán hàng',
          quantity: '1',
          unitPriceMinor: amountMinor,
          vatRuleType: 'vat_exempt',
        },
      ],
    });
  if (res.status !== 201) throw new Error(`postInvoice failed: ${JSON.stringify(res.body)}`);
  return res.body as { id: string; journalEntryId: string; totalMinor: string };
}

maybe('Customer receipts settling AR (Phase 2a A6)', () => {
  beforeAll(async () => {
    app = await makeApp();
    ({ adminCookie, smeId, hkdId } = await seedTwoCompaniesAndUsers(app));

    await seedVatRules();

    // Provision CoA for both companies (circular_133 / circular_88 both have 111/112/131).
    for (const id of [smeId, hkdId]) {
      const prov = await request(app.getHttpServer())
        .post(`/companies/${id}/coa/provision`)
        .set('Cookie', adminCookie);
      expect(prov.status).toBe(200);
    }

    // FY2026 for both companies.
    for (const id of [smeId, hkdId]) {
      const res = await request(app.getHttpServer())
        .post(`/companies/${id}/fiscal-years`)
        .set('Cookie', adminCookie)
        .send({ fiscalYear: 2026 });
      expect(res.status).toBe(200);
    }

    // Create a customer for the SME.
    const cust = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'C001', name: 'Khách hàng A', partnerType: 'customer' });
    expect(cust.status).toBe(201);
    customerId = cust.body.id as string;

    // A customer belonging to the OTHER company (for the cross-company test).
    const hkdCust = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'H001', name: 'Khách HKD', partnerType: 'customer' });
    expect(hkdCust.status).toBe(201);
    hkdCustomerId = hkdCust.body.id as string;
  });

  afterAll(async () => {
    await closeApp(app);
  });

  // -------------------------------------------------------------------------
  // Core: post invoice T, post partial receipt R, AR = T − R.
  // -------------------------------------------------------------------------
  it('partial cash receipt (111): AR = invoice total − receipt amount', async () => {
    const pid = await periodId(1);

    // Post a sales invoice for 5,000,000 (exempt, so total = 5,000,000).
    const invoice = await postInvoice(smeId, customerId, pid, '5000000');
    const invoiceTotal = BigInt(invoice.totalMinor);
    expect(invoiceTotal).toBe(5000000n);

    // AR is now 5,000,000.
    expect(await arBalance(smeId, customerId)).toBe(5000000n);

    // Post a receipt of 2,000,000 to account 111 (cash).
    const receiptAmount = '2000000';
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/customer-receipts`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: customerId,
        receiptDate: '2026-03-10',
        periodId: pid,
        amountMinor: receiptAmount,
        settlementAccountCode: '111',
        description: 'Thu tiền mặt',
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('posted');
    expect(res.body.amountMinor).toBe(receiptAmount);
    expect(res.body.settlementAccountCode).toBe('111');
    expect(res.body.receiptNo).toBe(1);
    expect(res.body.partnerId).toBe(customerId);
    expect(res.body.journalEntryId).toBeTruthy();

    // AR = 5,000,000 − 2,000,000 = 3,000,000.
    expect(await arBalance(smeId, customerId)).toBe(3000000n);

    // Inspect the journal entry: Dr 111 / Cr 131 (partnerId), balanced.
    const je = await request(app.getHttpServer())
      .get(`/journal-entries/${res.body.journalEntryId}`)
      .set('Cookie', adminCookie);
    expect(je.status).toBe(200);
    expect(je.body.status).toBe('posted');

    const acct111 = await accountId(smeId, '111');
    const acct131 = await accountId(smeId, '131');

    const lines: Array<{
      accountId: string;
      debitMinor: string;
      creditMinor: string;
      partnerId: string | null;
    }> = je.body.lines;

    const dr111 = lines.find((l) => l.accountId === acct111)!;
    const cr131 = lines.find((l) => l.accountId === acct131)!;

    expect(dr111).toBeTruthy();
    expect(dr111.debitMinor).toBe('2000000');
    expect(dr111.creditMinor).toBe('0');

    expect(cr131).toBeTruthy();
    expect(cr131.debitMinor).toBe('0');
    expect(cr131.creditMinor).toBe('2000000');
    expect(cr131.partnerId).toBe(customerId);

    // Double-entry balanced.
    const totDr = lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const totCr = lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(totDr).toBe(totCr);
    expect(totDr).toBe(2000000n);
  });

  // -------------------------------------------------------------------------
  // Bank settlement (112) works.
  // -------------------------------------------------------------------------
  it('bank receipt (112): Dr 112 / Cr 131 (partnerId), balanced', async () => {
    const pid = await periodId(1);

    // Fresh customer so AR sum is isolated.
    const cust = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'C-BANK', name: 'KH ngân hàng', partnerType: 'customer' });
    expect(cust.status).toBe(201);
    const bankCustId = cust.body.id as string;

    await postInvoice(smeId, bankCustId, pid, '8000000');
    expect(await arBalance(smeId, bankCustId)).toBe(8000000n);

    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/customer-receipts`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: bankCustId,
        receiptDate: '2026-03-11',
        periodId: pid,
        amountMinor: '8000000',
        settlementAccountCode: '112',
      });

    expect(res.status).toBe(201);
    expect(res.body.settlementAccountCode).toBe('112');

    // AR fully settled.
    expect(await arBalance(smeId, bankCustId)).toBe(0n);

    const je = await request(app.getHttpServer())
      .get(`/journal-entries/${res.body.journalEntryId}`)
      .set('Cookie', adminCookie);

    const acct112 = await accountId(smeId, '112');
    const acct131 = await accountId(smeId, '131');
    const lines: Array<{ accountId: string; debitMinor: string; creditMinor: string; partnerId: string | null }> =
      je.body.lines;

    const dr112 = lines.find((l) => l.accountId === acct112)!;
    const cr131 = lines.find((l) => l.accountId === acct131)!;
    expect(dr112.debitMinor).toBe('8000000');
    expect(cr131.creditMinor).toBe('8000000');
    expect(cr131.partnerId).toBe(bankCustId);

    const totDr = lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const totCr = lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(totDr).toBe(totCr);
  });

  // -------------------------------------------------------------------------
  // Cancel: AR returns to invoice total; re-cancel → 422.
  // -------------------------------------------------------------------------
  it('cancel receipt → AR returns to invoice total; re-cancel → 422', async () => {
    const pid = await periodId(1);

    // Fresh customer so AR is isolated.
    const cust = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'C-CANCEL', name: 'KH hủy phiếu thu', partnerType: 'customer' });
    expect(cust.status).toBe(201);
    const cancelCustId = cust.body.id as string;

    const invoice = await postInvoice(smeId, cancelCustId, pid, '10000000');
    const T = BigInt(invoice.totalMinor); // 10,000,000

    // Post a receipt of 4,000,000.
    const rcpt = await request(app.getHttpServer())
      .post(`/companies/${smeId}/customer-receipts`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: cancelCustId,
        receiptDate: '2026-03-15',
        periodId: pid,
        amountMinor: '4000000',
        settlementAccountCode: '111',
      });
    expect(rcpt.status).toBe(201);
    const receiptId = rcpt.body.id as string;
    const receiptJeId = rcpt.body.journalEntryId as string;

    // AR after receipt = 10,000,000 − 4,000,000 = 6,000,000.
    expect(await arBalance(smeId, cancelCustId)).toBe(T - 4000000n);

    // Cancel the receipt.
    const cancelRes = await request(app.getHttpServer())
      .post(`/customer-receipts/${receiptId}/cancel`)
      .set('Cookie', adminCookie);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe('cancelled');

    // Original journal entry should be 'reversed'.
    const je = await request(app.getHttpServer())
      .get(`/journal-entries/${receiptJeId}`)
      .set('Cookie', adminCookie);
    expect(je.body.status).toBe('reversed');

    // AR back to full invoice total.
    expect(await arBalance(smeId, cancelCustId)).toBe(T);

    // Re-cancel → 422.
    const again = await request(app.getHttpServer())
      .post(`/customer-receipts/${receiptId}/cancel`)
      .set('Cookie', adminCookie);
    expect(again.status).toBe(422);
  });

  // -------------------------------------------------------------------------
  // receiptNo increments per (company, fiscalYear).
  // -------------------------------------------------------------------------
  it('receiptNo increments per (company, fiscalYear)', async () => {
    const pid = await periodId(1);

    // Create a dedicated customer to avoid dependency on earlier tests' numbering.
    const cust = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'C-NUM', name: 'KH số', partnerType: 'customer' });
    const numCustId = cust.body.id as string;

    await postInvoice(smeId, numCustId, pid, '1000000');

    // First receipt in this company/FY → receiptNo = N (where N is max so far + 1).
    // Use an admin-context query (GUC-based) so FORCE RLS is satisfied when reading
    // the customer_receipts table directly.
    const maxBefore = await adminQuery<{ m: number }>(
      smeId,
      `SELECT COALESCE(MAX(receipt_no), 0)::int AS m FROM customer_receipts WHERE company_id='${smeId}' AND fiscal_year=2026`,
    );
    const expectedFirst = maxBefore[0]!.m + 1;

    const r1 = await request(app.getHttpServer())
      .post(`/companies/${smeId}/customer-receipts`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: numCustId,
        receiptDate: '2026-03-20',
        periodId: pid,
        amountMinor: '500000',
        settlementAccountCode: '111',
      });
    expect(r1.status).toBe(201);
    expect(r1.body.receiptNo).toBe(expectedFirst);

    await postInvoice(smeId, numCustId, pid, '1000000');

    const r2 = await request(app.getHttpServer())
      .post(`/companies/${smeId}/customer-receipts`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: numCustId,
        receiptDate: '2026-03-21',
        periodId: pid,
        amountMinor: '500000',
        settlementAccountCode: '111',
      });
    expect(r2.status).toBe(201);
    expect(r2.body.receiptNo).toBe(expectedFirst + 1);
  });

  // -------------------------------------------------------------------------
  // Cross-company partnerId → 422.
  // -------------------------------------------------------------------------
  it('partnerId from another company → 422', async () => {
    const pid = await periodId(1);
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/customer-receipts`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: hkdCustomerId, // belongs to hkdId, not smeId
        receiptDate: '2026-03-22',
        periodId: pid,
        amountMinor: '1000000',
        settlementAccountCode: '111',
      });
    expect(res.status).toBe(422);
  });

  // -------------------------------------------------------------------------
  // Unauthenticated → 401.
  // -------------------------------------------------------------------------
  it('unauthenticated POST → 401', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/customer-receipts`)
      .send({
        partnerId: customerId,
        receiptDate: '2026-03-22',
        periodId: 'irrelevant',
        amountMinor: '1000000',
        settlementAccountCode: '111',
      });
    expect(res.status).toBe(401);
  });

  // -------------------------------------------------------------------------
  // Access to another company → 403.
  // -------------------------------------------------------------------------
  it('access to another company → 403', async () => {
    // Seed a non-admin user with access only to smeId, then attempt to reach hkdId.
    const { acctCookie } = await (async () => {
      // acctCookie already grants access to smeId only (from seedTwoCompaniesAndUsers).
      // We need a fresh user or re-use the seeded accountant's cookie; the seed
      // function already returns it via adminCookie (the only returned values), but
      // we seeded only adminCookie. Let's do a minimal inline seed.
      const http = () => request(app.getHttpServer());
      const user = await http()
        .post('/users')
        .set('Cookie', adminCookie)
        .send({ email: 'rcpt-acct@example.com', password: 'S3cure!passw0rd', displayName: 'RA' });
      expect(user.status).toBe(201);
      await http()
        .post('/company-access')
        .set('Cookie', adminCookie)
        .send({ userId: user.body.id, companyId: smeId, role: 'accountant' });
      const login = await http()
        .post('/auth/login')
        .send({ email: 'rcpt-acct@example.com', password: 'S3cure!passw0rd' });
      expect(login.status).toBe(200);
      const header = login.headers['set-cookie'] as string[] | string | undefined;
      const cookies = Array.isArray(header) ? header : header ? [header] : [];
      const acctCookie = cookies.find((c) => c.startsWith('sid='))!.split(';')[0]!;
      return { acctCookie };
    })();

    // Accountant can access smeId but NOT hkdId.
    // Use a nil UUID so Zod validation passes and the 403 is returned by the access gate.
    const res = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/customer-receipts`)
      .set('Cookie', acctCookie)
      .send({
        partnerId: hkdCustomerId,
        receiptDate: '2026-03-22',
        periodId: '00000000-0000-0000-0000-000000000000',
        amountMinor: '1000000',
        settlementAccountCode: '111',
      });
    expect(res.status).toBe(403);
  });

  // -------------------------------------------------------------------------
  // amountMinor ≤ 0 → 400 (Zod rejects non-positive integer strings).
  // -------------------------------------------------------------------------
  it('amountMinor = "0" → 400 (Zod)', async () => {
    const pid = await periodId(1);
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/customer-receipts`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: customerId,
        receiptDate: '2026-03-22',
        periodId: pid,
        amountMinor: '0',
        settlementAccountCode: '111',
      });
    expect(res.status).toBe(400);
  });

  it('amountMinor negative string → 400 (Zod)', async () => {
    const pid = await periodId(1);
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/customer-receipts`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: customerId,
        receiptDate: '2026-03-22',
        periodId: pid,
        amountMinor: '-1000',
        settlementAccountCode: '111',
      });
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // GET unknown receipt → 404.
  // -------------------------------------------------------------------------
  it('GET unknown receipt → 404', async () => {
    const res = await request(app.getHttpServer())
      .get('/customer-receipts/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });
});
