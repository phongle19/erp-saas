/**
 * Integration tests for e-invoice domain + selectable provider registry:
 *   - POST /sales-invoices/:id/einvoice  (issue)
 *   - GET  /einvoices/:id
 *   - POST /einvoices/:id/cancel
 *
 * DB-backed, runs as the NOBYPASSRLS `erp` role. Proves:
 *   - 201 issue with providerCode/soHoaDon/gdtMessageId + payload fields (seller/buyer MST + vat)
 *   - Default provider 'viettel' → providerCode prefixed 'VT-'
 *   - Provider selection: switch company.einvoice_provider to 'misa' → providerCode prefixed 'MISA-'
 *   - Non-posted (cancelled) invoice → 422
 *   - Double-issue (already issued) → 409
 *   - Cancel an issued e-invoice → status 'cancelled'
 *   - Cross-company RLS → 404, unauthenticated → 401
 *
 * Statutory basis:
 *   - Decree 123/2020/ND-CP: e-invoice framework
 *   - Decree 70/2025/ND-CP: amendments
 *   - Circular 78/2021/TT-BTC: technical implementation
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
let acctCookie: string;
let smeId: string;
let hkdId: string;
let customerId: string;
/** A posted sales invoice on the SME belonging to customerId. */
let postedInvoiceId: string;
/** Journal entry id of the posted invoice (used to verify it stays intact). */
let postedInvoiceJeId: string;

/** Fetch the SME's open period for a given periodNo in FY2026. */
async function periodId(companyId: string, periodNo: number, fy = 2026): Promise<string> {
  const res = await request(app.getHttpServer())
    .get(`/companies/${companyId}/periods?fiscalYear=${fy}`)
    .set('Cookie', adminCookie);
  const p = (res.body as Array<{ periodNo: number; id: string }>).find(
    (x) => x.periodNo === periodNo,
  );
  if (!p) throw new Error(`period ${periodNo}/${fy} not found for company ${companyId}`);
  return p.id;
}

/** Seed VAT tax_rules required for invoice posting. */
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
 * Run a query inside an admin-context tx so FORCE RLS on company-scoped tables
 * is satisfied via the three GUCs (mirrors the request-path tenant tx).
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

/**
 * Update the company's einvoice_provider directly via DB in an admin-context tx
 * (GUCs set to satisfy FORCE RLS on company-scoped tables).
 */
async function setEinvoiceProvider(
  companyId: string,
  provider: 'viettel' | 'vnpt' | 'misa',
): Promise<void> {
  await app.rawSql.begin(async (tx) => {
    await tx.unsafe(
      `SELECT set_config('app.user_id','00000000-0000-0000-0000-000000000001', true)`,
    );
    await tx.unsafe(`SELECT set_config('app.is_admin','true', true)`);
    await tx.unsafe(
      `SELECT set_config('app.accessible_companies','${companyId}', true)`,
    );
    await tx.unsafe(
      `UPDATE companies SET einvoice_provider = '${provider}' WHERE id = '${companyId}'`,
    );
  });
}

/** Create and post a sales invoice; return { id, journalEntryId }. */
async function createPostedInvoice(
  companyId: string,
  partnerId: string,
  pid: string,
  sellerMst?: string,
): Promise<{ id: string; journalEntryId: string }> {
  // Set the company MST so the seller MST appears in the payload.
  if (sellerMst) {
    await app.rawSql.begin(async (tx) => {
      await tx.unsafe(
        `SELECT set_config('app.user_id','00000000-0000-0000-0000-000000000001', true)`,
      );
      await tx.unsafe(`SELECT set_config('app.is_admin','true', true)`);
      await tx.unsafe(
        `SELECT set_config('app.accessible_companies','${companyId}', true)`,
      );
      await tx.unsafe(
        `UPDATE companies SET mst = '${sellerMst}' WHERE id = '${companyId}'`,
      );
    });
  }

  const res = await request(app.getHttpServer())
    .post(`/companies/${companyId}/sales-invoices`)
    .set('Cookie', adminCookie)
    .send({
      partnerId,
      invoiceDate: '2026-03-01',
      periodId: pid,
      description: 'Hàng hóa test e-invoice',
      lines: [
        {
          description: 'Hàng A (10%)',
          quantity: '2',
          unitPriceMinor: '5000000',
          vatRuleType: 'vat_rate',
        },
      ],
    });
  if (res.status !== 201) {
    throw new Error(`createPostedInvoice failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { id: res.body.id as string, journalEntryId: res.body.journalEntryId as string };
}

maybe('E-invoice domain — selectable provider registry', () => {
  beforeAll(async () => {
    app = await makeApp();
    ({ adminCookie, acctCookie, smeId, hkdId } = await seedTwoCompaniesAndUsers(app));

    await seedVatRules();

    // Provision CoA for both companies.
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

    // Create a customer with MST for the SME.
    const cust = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({
        code: 'CUST-EI',
        name: 'Công ty mua GTGT',
        partnerType: 'customer',
        taxCode: '0101234567',
        address: '123 Lê Lợi, Hà Nội',
      });
    expect(cust.status).toBe(201);
    customerId = cust.body.id as string;

    // Create a posted sales invoice (default provider = viettel).
    const pid = await periodId(smeId, 1);
    const inv = await createPostedInvoice(smeId, customerId, pid, '0102345678');
    postedInvoiceId = inv.id;
    postedInvoiceJeId = inv.journalEntryId;
  });

  afterAll(async () => {
    await closeApp(app);
  });

  // -------------------------------------------------------------------------
  // Issue e-invoice for the posted invoice — default provider (viettel).
  // -------------------------------------------------------------------------
  it('issue for a posted invoice → 201, viettel tag, providerCode/soHoaDon/gdtMessageId present', async () => {
    const res = await request(app.getHttpServer())
      .post(`/sales-invoices/${postedInvoiceId}/einvoice`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('issued');

    // Provider tag: default is viettel → 'VT-' prefix.
    expect(res.body.provider).toBe('viettel');
    expect(res.body.providerCode).toMatch(/^VT-/);
    expect(res.body.soHoaDon).toBeTruthy();
    expect(res.body.gdtMessageId).toMatch(/^GDT-VT-/);

    // Bigint fields serialized as strings.
    expect(res.body.subtotalMinor).toBe('10000000');
    expect(res.body.vatMinor).toBe('1000000');
    expect(res.body.totalMinor).toBe('11000000');

    // Payload carries seller MST + buyer MST + vat.
    const payload = res.body.payload as {
      seller: { mst: string };
      buyer: { mst: string; name: string };
      vat: string;
      subtotal: string;
    };
    expect(payload.seller.mst).toBe('0102345678');
    expect(payload.buyer.mst).toBe('0101234567');
    expect(payload.vat).toBe('1000000');
    expect(payload.subtotal).toBe('10000000');

    // issuedAt is set.
    expect(res.body.issuedAt).toBeTruthy();

    // The e-invoice id for subsequent tests.
    expect(res.body.id).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // GET the e-invoice.
  // -------------------------------------------------------------------------
  it('GET /einvoices/:id → 200 with the issued e-invoice', async () => {
    // Retrieve the e-invoice id from the DB via admin-context tx (FORCE RLS requires GUCs).
    const rows = await adminQuery<{ id: string }>(
      smeId,
      `SELECT id FROM einvoices WHERE sales_invoice_id = '${postedInvoiceId}' LIMIT 1`,
    );
    const eid = rows[0]!.id;

    const res = await request(app.getHttpServer())
      .get(`/einvoices/${eid}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(eid);
    expect(res.body.status).toBe('issued');
  });

  // -------------------------------------------------------------------------
  // Double-issue (idempotency) → 409.
  // -------------------------------------------------------------------------
  it('double-issue the same posted invoice → 409 Conflict', async () => {
    const res = await request(app.getHttpServer())
      .post(`/sales-invoices/${postedInvoiceId}/einvoice`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(409);
  });

  // -------------------------------------------------------------------------
  // Non-posted invoice (cancelled) → 422.
  // -------------------------------------------------------------------------
  it('issue for a cancelled invoice → 422', async () => {
    const pid = await periodId(smeId, 1);

    // Create a second invoice and cancel it.
    const inv2 = await createPostedInvoice(smeId, customerId, pid);
    const cancelRes = await request(app.getHttpServer())
      .post(`/sales-invoices/${inv2.id}/cancel`)
      .set('Cookie', adminCookie);
    expect(cancelRes.status).toBe(200);

    // Try to issue an e-invoice for the cancelled invoice.
    const res = await request(app.getHttpServer())
      .post(`/sales-invoices/${inv2.id}/einvoice`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/only posted/i);
  });

  // -------------------------------------------------------------------------
  // Provider selection: switch to MISA → providerCode has 'MISA-' prefix.
  // -------------------------------------------------------------------------
  it('provider selection: misa → providerCode prefixed MISA-', async () => {
    // Switch the SME's provider to 'misa'.
    await setEinvoiceProvider(smeId, 'misa');

    const pid = await periodId(smeId, 2);
    const inv = await createPostedInvoice(smeId, customerId, pid);

    const res = await request(app.getHttpServer())
      .post(`/sales-invoices/${inv.id}/einvoice`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(201);
    expect(res.body.provider).toBe('misa');
    expect(res.body.providerCode).toMatch(/^MISA-/);
    expect(res.body.gdtMessageId).toMatch(/^GDT-MISA-/);

    // Reset back to viettel for subsequent tests.
    await setEinvoiceProvider(smeId, 'viettel');
  });

  // -------------------------------------------------------------------------
  // Cancel an issued e-invoice → status 'cancelled'.
  // -------------------------------------------------------------------------
  it('cancel an issued e-invoice → status cancelled', async () => {
    // Issue a fresh e-invoice for a fresh posted invoice.
    const pid = await periodId(smeId, 3);
    const inv = await createPostedInvoice(smeId, customerId, pid);

    const issueRes = await request(app.getHttpServer())
      .post(`/sales-invoices/${inv.id}/einvoice`)
      .set('Cookie', adminCookie);
    expect(issueRes.status).toBe(201);
    const eid = issueRes.body.id as string;

    // Cancel it.
    const cancelRes = await request(app.getHttpServer())
      .post(`/einvoices/${eid}/cancel`)
      .set('Cookie', adminCookie);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe('cancelled');

    // After cancellation, GET shows 'cancelled'.
    const getRes = await request(app.getHttpServer())
      .get(`/einvoices/${eid}`)
      .set('Cookie', adminCookie);
    expect(getRes.body.status).toBe('cancelled');

    // The sales invoice GL journal entry is unaffected (e-invoice is not a GL event).
    const je = await request(app.getHttpServer())
      .get(`/journal-entries/${inv.journalEntryId}`)
      .set('Cookie', adminCookie);
    expect(je.body.status).toBe('posted'); // not reversed
  });

  // -------------------------------------------------------------------------
  // Re-issue after cancellation is allowed (no 'issued' row exists now).
  // -------------------------------------------------------------------------
  it('re-issue after cancellation is allowed', async () => {
    const pid = await periodId(smeId, 4);
    const inv = await createPostedInvoice(smeId, customerId, pid);

    // Issue then cancel.
    const iss1 = await request(app.getHttpServer())
      .post(`/sales-invoices/${inv.id}/einvoice`)
      .set('Cookie', adminCookie);
    expect(iss1.status).toBe(201);
    await request(app.getHttpServer())
      .post(`/einvoices/${iss1.body.id}/cancel`)
      .set('Cookie', adminCookie);

    // Re-issue → should succeed.
    const iss2 = await request(app.getHttpServer())
      .post(`/sales-invoices/${inv.id}/einvoice`)
      .set('Cookie', adminCookie);
    expect(iss2.status).toBe(201);
    expect(iss2.body.status).toBe('issued');
  });

  // -------------------------------------------------------------------------
  // Cross-company: accountant (SME-only) cannot see HKD e-invoices.
  // -------------------------------------------------------------------------
  it('cross-company: HKD invoice not accessible to SME accountant', async () => {
    // Create a customer + posted invoice for HKD.
    const hkdCust = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/partners`)
      .set('Cookie', adminCookie)
      .send({
        code: 'HKD-CUST',
        name: 'KH HKD',
        partnerType: 'customer',
      });
    expect(hkdCust.status).toBe(201);

    const hkdPid = await periodId(hkdId, 1);
    const hkdInv = await createPostedInvoice(hkdId, hkdCust.body.id as string, hkdPid);

    // Issue as admin for HKD invoice.
    const issRes = await request(app.getHttpServer())
      .post(`/sales-invoices/${hkdInv.id}/einvoice`)
      .set('Cookie', adminCookie);
    expect(issRes.status).toBe(201);
    const eid = issRes.body.id as string;

    // Accountant (has access to SME only) trying to GET the HKD e-invoice → 403/404.
    const getRes = await request(app.getHttpServer())
      .get(`/einvoices/${eid}`)
      .set('Cookie', acctCookie);
    expect([403, 404]).toContain(getRes.status);
  });

  // -------------------------------------------------------------------------
  // Unauthenticated → 401.
  // -------------------------------------------------------------------------
  it('unauthenticated request → 401', async () => {
    const res = await request(app.getHttpServer())
      .post(`/sales-invoices/${postedInvoiceId}/einvoice`);
    expect(res.status).toBe(401);

    const res2 = await request(app.getHttpServer())
      .get('/einvoices/00000000-0000-0000-0000-000000000000');
    expect(res2.status).toBe(401);
  });

  // -------------------------------------------------------------------------
  // GET non-existent e-invoice → 404.
  // -------------------------------------------------------------------------
  it('GET unknown e-invoice → 404', async () => {
    const res = await request(app.getHttpServer())
      .get('/einvoices/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });
});
