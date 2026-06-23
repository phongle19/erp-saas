/**
 * Integration tests for vendor payments settling AP (Phase 2b B8):
 *   - POST /companies/:id/vendor-payments   (createAndPost)
 *   - GET  /vendor-payments/:id
 *   - POST /vendor-payments/:id/cancel
 *
 * DB-backed, runs as the NOBYPASSRLS `erp` role. The P4 double-entry +
 * immutability triggers are in force. Proves:
 *   - Dr 331 (AP, with partnerId) / Cr 111 posting settles AP correctly,
 *   - Dr 331 / Cr 112 posting (bank settlement) also works,
 *   - AP balance (Σ 331 lines by partnerId: credit − debit) = invoice total − payment,
 *   - cancel reverses the entry; AP returns to invoice total,
 *   - re-cancel → 422 (already cancelled),
 *   - paymentNo increments per (company, fiscalYear),
 *   - cross-company vendor → 422,
 *   - unauthenticated → 401,
 *   - access to another company → 403,
 *   - amountMinor ≤ 0 → 400 (Zod).
 *
 * beforeAll: provision CoA, FY2026, a vendor + material, POST a purchase
 * invoice (AP = T) to create an outstanding payable to settle.
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
let matId: string;

/** Fetch the SME's open period for a given periodNo in FY2026. */
async function periodId(periodNo: number, fy = 2026): Promise<string> {
  const res = await request(app.getHttpServer())
    .get(`/companies/${smeId}/periods?fiscalYear=${fy}`)
    .set('Cookie', adminCookie);
  const p = res.body.find((x: { periodNo: number }) => x.periodNo === periodNo);
  if (!p) throw new Error(`period ${periodNo}/${fy} not found`);
  return p.id as string;
}

/** Seed the five VAT tax_rules (no-op if already seeded by another suite). */
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
 * Mirrors the adminQuery helper in receipts.int.test.ts.
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
 * AP balance (credit-positive, liability-normal) on account 331 for a vendor:
 * Σ(credit_minor − debit_minor) filtered by partnerId.
 */
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

/**
 * Post a purchase invoice (AP = T) for a vendor so there is a payable to settle.
 * Uses a single exempt line so there is no VAT complexity.
 */
async function postPurchaseInvoice(
  companyId: string,
  partnerId: string,
  materialId: string,
  periodIdVal: string,
  unitCostMinor: string,
): Promise<{ id: string; journalEntryId: string; totalMinor: string }> {
  const res = await request(app.getHttpServer())
    .post(`/companies/${companyId}/purchase-invoices`)
    .set('Cookie', adminCookie)
    .send({
      partnerId,
      invoiceDate: '2026-03-01',
      periodId: periodIdVal,
      lines: [
        {
          materialId,
          quantity: '1',
          unitCostMinor,
          vatRuleType: 'vat_exempt',
        },
      ],
    });
  if (res.status !== 201) {
    throw new Error(`postPurchaseInvoice failed: ${JSON.stringify(res.body)}`);
  }
  return res.body as { id: string; journalEntryId: string; totalMinor: string };
}

maybe('Vendor payments settling AP (Phase 2b B8)', () => {
  beforeAll(async () => {
    app = await makeApp();
    ({ adminCookie, smeId, hkdId } = await seedTwoCompaniesAndUsers(app));

    await seedVatRules();

    // Provision CoA for both companies (circular_133 / circular_88 both have 111/112/331).
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

    // Vendor (partnerType vendor) for the SME.
    const vendor = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'V001', name: 'Nhà cung cấp A', partnerType: 'vendor' });
    expect(vendor.status).toBe(201);
    vendorId = vendor.body.id as string;

    // Vendor belonging to the OTHER company (for the cross-company test).
    const hkdVendor = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'HV001', name: 'NCC HKD', partnerType: 'vendor' });
    expect(hkdVendor.status).toBe(201);
    hkdVendorId = hkdVendor.body.id as string;

    // A material for the SME (needed to post a purchase invoice).
    const mat = await request(app.getHttpServer())
      .post(`/companies/${smeId}/materials`)
      .set('Cookie', adminCookie)
      .send({ code: 'M001', name: 'Vật tư thanh toán' });
    expect(mat.status).toBe(201);
    matId = mat.body.id as string;
  });

  afterAll(async () => {
    await closeApp(app);
  });

  // -------------------------------------------------------------------------
  // Core: post invoice T, post partial payment R via cash (111), AP = T − R.
  // -------------------------------------------------------------------------
  it('partial cash payment (111): AP = invoice total − payment amount', async () => {
    const pid = await periodId(1);

    // Post a purchase invoice for 5,000,000 (exempt → total = 5,000,000).
    const invoice = await postPurchaseInvoice(smeId, vendorId, matId, pid, '5000000');
    const invoiceTotal = BigInt(invoice.totalMinor);
    expect(invoiceTotal).toBe(5000000n);

    // AP is now 5,000,000.
    expect(await apBalance(smeId, vendorId)).toBe(5000000n);

    // Post a payment of 2,000,000 to account 111 (cash).
    const paymentAmount = '2000000';
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/vendor-payments`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: vendorId,
        paymentDate: '2026-03-10',
        periodId: pid,
        amountMinor: paymentAmount,
        settlementAccountCode: '111',
        description: 'Thanh toán tiền mặt',
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('posted');
    expect(res.body.amountMinor).toBe(paymentAmount);
    expect(res.body.settlementAccountCode).toBe('111');
    expect(res.body.paymentNo).toBe(1);
    expect(res.body.partnerId).toBe(vendorId);
    expect(res.body.journalEntryId).toBeTruthy();

    // AP = 5,000,000 − 2,000,000 = 3,000,000.
    expect(await apBalance(smeId, vendorId)).toBe(3000000n);

    // Inspect the journal entry: Dr 331 (partnerId) / Cr 111, balanced.
    const je = await request(app.getHttpServer())
      .get(`/journal-entries/${res.body.journalEntryId}`)
      .set('Cookie', adminCookie);
    expect(je.status).toBe(200);
    expect(je.body.status).toBe('posted');

    const acct331 = await accountId(smeId, '331');
    const acct111 = await accountId(smeId, '111');

    const lines: Array<{
      accountId: string;
      debitMinor: string;
      creditMinor: string;
      partnerId: string | null;
    }> = je.body.lines;

    const dr331 = lines.find((l) => l.accountId === acct331)!;
    const cr111 = lines.find((l) => l.accountId === acct111)!;

    expect(dr331).toBeTruthy();
    expect(dr331.debitMinor).toBe('2000000');
    expect(dr331.creditMinor).toBe('0');
    expect(dr331.partnerId).toBe(vendorId);

    expect(cr111).toBeTruthy();
    expect(cr111.debitMinor).toBe('0');
    expect(cr111.creditMinor).toBe('2000000');

    // Double-entry balanced.
    const totDr = lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const totCr = lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(totDr).toBe(totCr);
    expect(totDr).toBe(2000000n);
  });

  // -------------------------------------------------------------------------
  // Bank settlement (112) works.
  // -------------------------------------------------------------------------
  it('bank payment (112): Dr 331 (partnerId) / Cr 112, balanced', async () => {
    const pid = await periodId(1);

    // Fresh vendor so AP sum is isolated.
    const v = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'V-BANK', name: 'NCC ngân hàng', partnerType: 'vendor' });
    expect(v.status).toBe(201);
    const bankVendorId = v.body.id as string;

    // Fresh material for this vendor.
    const m = await request(app.getHttpServer())
      .post(`/companies/${smeId}/materials`)
      .set('Cookie', adminCookie)
      .send({ code: 'M-BANK', name: 'Vật tư ngân hàng' });
    expect(m.status).toBe(201);
    const bankMatId = m.body.id as string;

    await postPurchaseInvoice(smeId, bankVendorId, bankMatId, pid, '8000000');
    expect(await apBalance(smeId, bankVendorId)).toBe(8000000n);

    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/vendor-payments`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: bankVendorId,
        paymentDate: '2026-03-11',
        periodId: pid,
        amountMinor: '8000000',
        settlementAccountCode: '112',
      });

    expect(res.status).toBe(201);
    expect(res.body.settlementAccountCode).toBe('112');

    // AP fully settled.
    expect(await apBalance(smeId, bankVendorId)).toBe(0n);

    const je = await request(app.getHttpServer())
      .get(`/journal-entries/${res.body.journalEntryId}`)
      .set('Cookie', adminCookie);

    const acct331 = await accountId(smeId, '331');
    const acct112 = await accountId(smeId, '112');
    const lines: Array<{ accountId: string; debitMinor: string; creditMinor: string; partnerId: string | null }> =
      je.body.lines;

    const dr331 = lines.find((l) => l.accountId === acct331)!;
    const cr112 = lines.find((l) => l.accountId === acct112)!;
    expect(dr331.debitMinor).toBe('8000000');
    expect(dr331.partnerId).toBe(bankVendorId);
    expect(cr112.creditMinor).toBe('8000000');

    const totDr = lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const totCr = lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(totDr).toBe(totCr);
  });

  // -------------------------------------------------------------------------
  // Cancel: AP returns to invoice total; reversal carries partnerId; re-cancel → 422.
  // -------------------------------------------------------------------------
  it('cancel payment → AP returns to invoice total; reversal carries partnerId; re-cancel → 422', async () => {
    const pid = await periodId(1);

    // Fresh vendor so AP is isolated.
    const v = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'V-CANCEL', name: 'NCC hủy phiếu chi', partnerType: 'vendor' });
    expect(v.status).toBe(201);
    const cancelVendorId = v.body.id as string;

    // Fresh material.
    const m = await request(app.getHttpServer())
      .post(`/companies/${smeId}/materials`)
      .set('Cookie', adminCookie)
      .send({ code: 'M-CANCEL', name: 'Vật tư hủy' });
    expect(m.status).toBe(201);
    const cancelMatId = m.body.id as string;

    const invoice = await postPurchaseInvoice(smeId, cancelVendorId, cancelMatId, pid, '10000000');
    const T = BigInt(invoice.totalMinor); // 10,000,000

    // Post a payment of 4,000,000.
    const pmt = await request(app.getHttpServer())
      .post(`/companies/${smeId}/vendor-payments`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: cancelVendorId,
        paymentDate: '2026-03-15',
        periodId: pid,
        amountMinor: '4000000',
        settlementAccountCode: '111',
      });
    expect(pmt.status).toBe(201);
    const paymentId = pmt.body.id as string;
    const paymentJeId = pmt.body.journalEntryId as string;

    // AP after payment = 10,000,000 − 4,000,000 = 6,000,000.
    expect(await apBalance(smeId, cancelVendorId)).toBe(T - 4000000n);

    // Cancel the payment.
    const cancelRes = await request(app.getHttpServer())
      .post(`/vendor-payments/${paymentId}/cancel`)
      .set('Cookie', adminCookie);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe('cancelled');

    // Original journal entry should be 'reversed'.
    const je = await request(app.getHttpServer())
      .get(`/journal-entries/${paymentJeId}`)
      .set('Cookie', adminCookie);
    expect(je.body.status).toBe('reversed');

    // AP back to full invoice total (reversal also carries partnerId on 331 line).
    expect(await apBalance(smeId, cancelVendorId)).toBe(T);

    // Re-cancel → 422.
    const again = await request(app.getHttpServer())
      .post(`/vendor-payments/${paymentId}/cancel`)
      .set('Cookie', adminCookie);
    expect(again.status).toBe(422);
  });

  // -------------------------------------------------------------------------
  // paymentNo increments per (company, fiscalYear).
  // -------------------------------------------------------------------------
  it('paymentNo increments per (company, fiscalYear)', async () => {
    const pid = await periodId(1);

    // Dedicated vendor to avoid dependency on earlier tests' numbering.
    const v = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'V-NUM', name: 'NCC số', partnerType: 'vendor' });
    const numVendorId = v.body.id as string;

    const m = await request(app.getHttpServer())
      .post(`/companies/${smeId}/materials`)
      .set('Cookie', adminCookie)
      .send({ code: 'M-NUM', name: 'Vật tư số' });
    expect(m.status).toBe(201);
    const numMatId = m.body.id as string;

    await postPurchaseInvoice(smeId, numVendorId, numMatId, pid, '1000000');

    // Read max paymentNo before posting.
    const maxBefore = await adminQuery<{ m: number }>(
      smeId,
      `SELECT COALESCE(MAX(payment_no), 0)::int AS m FROM vendor_payments WHERE company_id='${smeId}' AND fiscal_year=2026`,
    );
    const expectedFirst = maxBefore[0]!.m + 1;

    const p1 = await request(app.getHttpServer())
      .post(`/companies/${smeId}/vendor-payments`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: numVendorId,
        paymentDate: '2026-03-20',
        periodId: pid,
        amountMinor: '500000',
        settlementAccountCode: '111',
      });
    expect(p1.status).toBe(201);
    expect(p1.body.paymentNo).toBe(expectedFirst);

    await postPurchaseInvoice(smeId, numVendorId, numMatId, pid, '1000000');

    const p2 = await request(app.getHttpServer())
      .post(`/companies/${smeId}/vendor-payments`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: numVendorId,
        paymentDate: '2026-03-21',
        periodId: pid,
        amountMinor: '500000',
        settlementAccountCode: '111',
      });
    expect(p2.status).toBe(201);
    expect(p2.body.paymentNo).toBe(expectedFirst + 1);
  });

  // -------------------------------------------------------------------------
  // Cross-company vendor → 422.
  // -------------------------------------------------------------------------
  it('vendor from another company → 422', async () => {
    const pid = await periodId(1);
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/vendor-payments`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: hkdVendorId, // belongs to hkdId, not smeId
        paymentDate: '2026-03-22',
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
      .post(`/companies/${smeId}/vendor-payments`)
      .send({
        partnerId: vendorId,
        paymentDate: '2026-03-22',
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
    const { acctCookie } = await (async () => {
      const http = () => request(app.getHttpServer());
      const user = await http()
        .post('/users')
        .set('Cookie', adminCookie)
        .send({ email: 'vpmt-acct@example.com', password: 'S3cure!passw0rd', displayName: 'VPA' });
      expect(user.status).toBe(201);
      await http()
        .post('/company-access')
        .set('Cookie', adminCookie)
        .send({ userId: user.body.id, companyId: smeId, role: 'accountant' });
      const login = await http()
        .post('/auth/login')
        .send({ email: 'vpmt-acct@example.com', password: 'S3cure!passw0rd' });
      expect(login.status).toBe(200);
      const header = login.headers['set-cookie'] as string[] | string | undefined;
      const cookies = Array.isArray(header) ? header : header ? [header] : [];
      const acctCookie = cookies.find((c) => c.startsWith('sid='))!.split(';')[0]!;
      return { acctCookie };
    })();

    // Accountant can access smeId but NOT hkdId.
    const res = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/vendor-payments`)
      .set('Cookie', acctCookie)
      .send({
        partnerId: hkdVendorId,
        paymentDate: '2026-03-22',
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
      .post(`/companies/${smeId}/vendor-payments`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: vendorId,
        paymentDate: '2026-03-22',
        periodId: pid,
        amountMinor: '0',
        settlementAccountCode: '111',
      });
    expect(res.status).toBe(400);
  });

  it('amountMinor negative string → 400 (Zod)', async () => {
    const pid = await periodId(1);
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/vendor-payments`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: vendorId,
        paymentDate: '2026-03-22',
        periodId: pid,
        amountMinor: '-1000',
        settlementAccountCode: '111',
      });
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // GET unknown payment → 404.
  // -------------------------------------------------------------------------
  it('GET unknown vendor payment → 404', async () => {
    const res = await request(app.getHttpServer())
      .get('/vendor-payments/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });
});
