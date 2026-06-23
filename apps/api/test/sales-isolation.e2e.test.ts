/**
 * Access-isolation e2e proof — sales/AR/e-invoice surface (Phase 2a A9).
 *
 * Extends the Phase-1 isolation guarantee to the full sales/AR/e-invoice surface.
 * Also proves the PostingEngine's new engine-level partner-company guard (Hardening 1).
 *
 * Scenario:
 *   - admin creates two companies: SME (circular_133) and Household (circular_88).
 *   - admin provisions CoA + generates FY2026 for BOTH companies.
 *   - admin creates a customer (partner) for EACH company.
 *   - admin posts a sales invoice to EACH company (with a receipt + e-invoice per company).
 *   - an accountant user is granted access to ONLY the SME.
 *
 * What we prove (each assertion documents the actual fail-closed behaviour):
 *
 *   PARTNERS (A4)
 *   ┌─ GET /companies/{hkd}/partners (acct) → 200 but empty (no leak of household partners)
 *   ├─ GET /partners/{householdPartnerId} (acct) → 404 (RLS hides it)
 *   ├─ POST /companies/{hkd}/partners (acct) → 403 (app-layer gate)
 *   ├─ GET /companies/{sme}/partners (acct) → 200 with data (positive control)
 *   └─ GET /partners/{smePartnerId} (acct) → 200 (positive control)
 *
 *   SALES INVOICES (A5)
 *   ┌─ GET /sales-invoices/{householdInvoiceId} (acct) → 404 (RLS hides it)
 *   ├─ POST /companies/{hkd}/sales-invoices (acct) → 403 (app-layer gate)
 *   ├─ POST /sales-invoices/{householdInvoiceId}/cancel (acct) → 404 (RLS hides invoice)
 *   ├─ GET /sales-invoices/{smeInvoiceId} (acct) → 200 (positive control)
 *   └─ GET /sales-invoices/{houseInvoiceId} (admin) → 200 (admin positive control)
 *
 *   RECEIPTS (A6)
 *   ┌─ GET /customer-receipts/{householdReceiptId} (acct) → 404 (RLS hides it)
 *   ├─ POST /companies/{hkd}/customer-receipts (acct) → 403 (app-layer gate)
 *   └─ GET /customer-receipts/{smeReceiptId} (acct) → 200 (positive control)
 *
 *   AR (A7)
 *   ┌─ GET /companies/{hkd}/ar (acct) → 200 but empty rows/total=0 (no household figures)
 *   ├─ GET /companies/{hkd}/ar/{householdPartnerId} (acct) → 404
 *   └─ GET /companies/{sme}/ar (acct) → 200 with SME data (positive control)
 *
 *   E-INVOICE (A8)
 *   ┌─ GET /einvoices/{householdEinvoiceId} (acct) → 404 (RLS hides it)
 *   ├─ POST /sales-invoices/{householdInvoiceId}/einvoice (acct) → 404 (invoice hidden)
 *   └─ GET /einvoices/{smeEinvoiceId} (acct) → 200 (positive control)
 *
 *   ENGINE PARTNER GUARD — Hardening 1
 *   └─ POST /journal-entries (admin, SME) with household partnerId → 422
 *        (PostingEngine: partner does not belong to this company)
 *
 *   ADMIN SANITY — admin sees both companies' data
 *   ├─ GET both companies' partners → 200 with rows
 *   ├─ GET invoices from both companies → 200
 *   └─ GET e-invoices from both companies → 200
 *
 *   UNAUTHENTICATED — fail-closed baseline (sampling)
 *   ├─ GET /partners/{id} → 401
 *   ├─ POST /companies/{hkd}/partners → 401
 *   ├─ GET /sales-invoices/{id} → 401
 *   └─ GET /einvoices/{id} → 401
 *
 * Runs against a real Postgres DB as the NOBYPASSRLS `erp` role.
 * Gated on TEST_DATABASE_URL / DATABASE_URL (skipped in unit-test environments).
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

// Partners
let smePartnerId: string;
let hkdPartnerId: string;

// Sales invoices
let smeInvoiceId: string;
let hkdInvoiceId: string;

// Receipts
let smeReceiptId: string;
let hkdReceiptId: string;

// E-invoices
let smeEinvoiceId: string;
let hkdEinvoiceId: string;

// Periods (for the engine partner guard test)
let smePeriodId: string;

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getPeriodId(companyId: string, periodNo: number, fy = 2026): Promise<string> {
  const res = await request(app.getHttpServer())
    .get(`/companies/${companyId}/periods?fiscalYear=${fy}`)
    .set('Cookie', adminCookie);
  const p = (res.body as Array<{ periodNo: number; id: string }>).find(
    (x) => x.periodNo === periodNo,
  );
  if (!p) throw new Error(`period ${periodNo}/${fy} not found for company ${companyId}`);
  return p.id;
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

/** Create a posted sales invoice; returns { id, journalEntryId }. */
async function createInvoice(
  companyId: string,
  partnerId: string,
  pid: string,
): Promise<{ id: string; journalEntryId: string }> {
  const res = await request(app.getHttpServer())
    .post(`/companies/${companyId}/sales-invoices`)
    .set('Cookie', adminCookie)
    .send({
      partnerId,
      invoiceDate: '2026-04-01',
      periodId: pid,
      description: 'Isolation test invoice',
      lines: [
        {
          description: 'Hàng A (10%)',
          quantity: '1',
          unitPriceMinor: '5000000',
          vatRuleType: 'vat_rate',
        },
      ],
    });
  if (res.status !== 201) {
    throw new Error(
      `createInvoice failed for company ${companyId}: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return { id: res.body.id as string, journalEntryId: res.body.journalEntryId as string };
}

/** Create a customer receipt; returns { id }. */
async function createReceipt(
  companyId: string,
  partnerId: string,
  pid: string,
): Promise<{ id: string }> {
  const res = await request(app.getHttpServer())
    .post(`/companies/${companyId}/customer-receipts`)
    .set('Cookie', adminCookie)
    .send({
      partnerId,
      receiptDate: '2026-04-05',
      periodId: pid,
      amountMinor: '1000000',
      settlementAccountCode: '111',
      description: 'Isolation test receipt',
    });
  if (res.status !== 201) {
    throw new Error(
      `createReceipt failed for company ${companyId}: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return { id: res.body.id as string };
}

/** Issue an e-invoice for a sales invoice; returns { id }. */
async function issueEinvoice(salesInvoiceId: string): Promise<{ id: string }> {
  const res = await request(app.getHttpServer())
    .post(`/sales-invoices/${salesInvoiceId}/einvoice`)
    .set('Cookie', adminCookie);
  if (res.status !== 201) {
    throw new Error(
      `issueEinvoice failed for invoice ${salesInvoiceId}: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return { id: res.body.id as string };
}

// ─── Test suite ─────────────────────────────────────────────────────────────

maybe('access-isolation: sales/AR/e-invoice surface (Phase 2a A9)', () => {
  beforeAll(async () => {
    app = await makeApp();
    ({ adminCookie, acctCookie, smeId, hkdId } = await seedTwoCompaniesAndUsers(app));

    await seedVatRules();

    // Provision CoA for both companies
    for (const id of [smeId, hkdId]) {
      const prov = await request(app.getHttpServer())
        .post(`/companies/${id}/coa/provision`)
        .set('Cookie', adminCookie);
      if (prov.status !== 200) {
        throw new Error(
          `provision CoA failed for ${id}: ${prov.status} ${JSON.stringify(prov.body)}`,
        );
      }
    }

    // Generate FY2026 for both companies
    for (const id of [smeId, hkdId]) {
      const res = await request(app.getHttpServer())
        .post(`/companies/${id}/fiscal-years`)
        .set('Cookie', adminCookie)
        .send({ fiscalYear: 2026 });
      if (res.status !== 200) {
        throw new Error(
          `generate FY2026 failed for ${id}: ${res.status} ${JSON.stringify(res.body)}`,
        );
      }
    }

    // Resolve periods
    smePeriodId = await getPeriodId(smeId, 1);
    const hkdPeriodId = await getPeriodId(hkdId, 1);

    // Create a partner (customer) for each company
    const smeCust = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'ISO-SME', name: 'SME Customer', partnerType: 'customer' });
    if (smeCust.status !== 201) {
      throw new Error(`create SME partner failed: ${smeCust.status} ${JSON.stringify(smeCust.body)}`);
    }
    smePartnerId = smeCust.body.id as string;

    const hkdCust = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'ISO-HKD', name: 'HKD Customer', partnerType: 'customer' });
    if (hkdCust.status !== 201) {
      throw new Error(`create HKD partner failed: ${hkdCust.status} ${JSON.stringify(hkdCust.body)}`);
    }
    hkdPartnerId = hkdCust.body.id as string;

    // Create sales invoices for each company
    const smeInv = await createInvoice(smeId, smePartnerId, smePeriodId);
    smeInvoiceId = smeInv.id;

    const hkdInv = await createInvoice(hkdId, hkdPartnerId, hkdPeriodId);
    hkdInvoiceId = hkdInv.id;

    // Create receipts for each company
    const smeRcpt = await createReceipt(smeId, smePartnerId, smePeriodId);
    smeReceiptId = smeRcpt.id;

    const hkdRcpt = await createReceipt(hkdId, hkdPartnerId, hkdPeriodId);
    hkdReceiptId = hkdRcpt.id;

    // Issue e-invoices for each company (admin)
    const smeEi = await issueEinvoice(smeInvoiceId);
    smeEinvoiceId = smeEi.id;

    const hkdEi = await issueEinvoice(hkdInvoiceId);
    hkdEinvoiceId = hkdEi.id;
  });

  afterAll(async () => {
    await closeApp(app);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // UNAUTHENTICATED — fail-closed baseline
  // ═══════════════════════════════════════════════════════════════════════════

  it('unauthenticated: GET /partners/:id → 401', async () => {
    const res = await request(app.getHttpServer())
      .get(`/partners/${smePartnerId}`);
    expect(res.status).toBe(401);
  });

  it('unauthenticated: POST /companies/:id/partners → 401', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/partners`)
      .send({ code: 'X', name: 'X', partnerType: 'customer' });
    expect(res.status).toBe(401);
  });

  it('unauthenticated: GET /sales-invoices/:id → 401', async () => {
    const res = await request(app.getHttpServer())
      .get(`/sales-invoices/${smeInvoiceId}`);
    expect(res.status).toBe(401);
  });

  it('unauthenticated: GET /einvoices/:id → 401', async () => {
    const res = await request(app.getHttpServer())
      .get(`/einvoices/${smeEinvoiceId}`);
    expect(res.status).toBe(401);
  });

  it('unauthenticated: GET /companies/:id/ar → 401', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ar?fiscalYear=2026`);
    expect(res.status).toBe(401);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ADMIN SANITY — admin sees both companies' data
  // ═══════════════════════════════════════════════════════════════════════════

  it('admin: GET SME partners → 200 with smePartnerId present', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(smePartnerId);
  });

  it('admin: GET HKD partners → 200 with hkdPartnerId present', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${hkdId}/partners`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(hkdPartnerId);
  });

  it('admin: GET SME sales invoice → 200', async () => {
    const res = await request(app.getHttpServer())
      .get(`/sales-invoices/${smeInvoiceId}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(smeInvoiceId);
    expect(res.body.companyId).toBe(smeId);
  });

  it('admin: GET HKD sales invoice → 200 (positive control)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/sales-invoices/${hkdInvoiceId}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(hkdInvoiceId);
    expect(res.body.companyId).toBe(hkdId);
  });

  it('admin: GET HKD e-invoice → 200 (positive control)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/einvoices/${hkdEinvoiceId}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(hkdEinvoiceId);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PARTNERS — accountant can only see SME partners
  // ═══════════════════════════════════════════════════════════════════════════

  it('accountant: GET /companies/{sme}/partners → 200 with SME partner (positive control)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/partners`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(smePartnerId);
    // Household partner must NOT appear
    expect(ids).not.toContain(hkdPartnerId);
  });

  it('accountant: GET /companies/{hkd}/partners → 200 but EMPTY (no household partners leak)', async () => {
    // RLS filters business_partners by accessible companies; the accountant
    // has no access to hkdId so all household partners are hidden.
    // The query returns an empty list (not 404 — the list endpoint filters silently).
    const res = await request(app.getHttpServer())
      .get(`/companies/${hkdId}/partners`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
    // Household partner must not appear in any form
    expect(JSON.stringify(res.body)).not.toContain(hkdPartnerId);
  });

  it('accountant: GET /partners/{hkdPartnerId} → 404 (RLS hides it)', async () => {
    // PartnersService.get() does a db.select() scoped by RLS; the household
    // partner is invisible to the accountant → 404.
    const res = await request(app.getHttpServer())
      .get(`/partners/${hkdPartnerId}`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(404);
  });

  it('accountant: GET /partners/{smePartnerId} → 200 (positive control)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/partners/${smePartnerId}`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(smePartnerId);
  });

  it('accountant: POST /companies/{hkd}/partners → 403 (app-layer gate)', async () => {
    // PartnersService.create() checks accessibleCompanies before any DB write.
    const res = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/partners`)
      .set('Cookie', acctCookie)
      .send({ code: 'X99', name: 'Attempted cross-write', partnerType: 'customer' });
    expect(res.status).toBe(403);
  });

  it('accountant: POST /companies/{sme}/partners → 201 (positive control)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', acctCookie)
      .send({ code: 'ACCT-NEW', name: 'Accountant new partner', partnerType: 'customer' });
    expect(res.status).toBe(201);
    expect(res.body.companyId).toBe(smeId);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SALES INVOICES — accountant cannot see or mutate HKD invoices
  // ═══════════════════════════════════════════════════════════════════════════

  it('accountant: GET /sales-invoices/{smeInvoiceId} → 200 (positive control)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/sales-invoices/${smeInvoiceId}`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(smeInvoiceId);
    expect(res.body.companyId).toBe(smeId);
  });

  it('accountant: GET /sales-invoices/{hkdInvoiceId} → 404 (RLS hides it)', async () => {
    // SalesInvoiceService.get() does a RLS-scoped select; household row hidden → 404.
    const res = await request(app.getHttpServer())
      .get(`/sales-invoices/${hkdInvoiceId}`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(404);
  });

  it('accountant: POST /companies/{hkd}/sales-invoices → 403 (app-layer gate)', async () => {
    // SalesInvoiceService.createAndPost() calls PostingEngine.post() which
    // checks accessibleCompanies before any DB write.
    const res = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/sales-invoices`)
      .set('Cookie', acctCookie)
      .send({
        partnerId: hkdPartnerId,
        invoiceDate: '2026-04-10',
        periodId: '00000000-0000-0000-0000-000000000000',
        lines: [
          { description: 'X', quantity: '1', unitPriceMinor: '1000000', vatRuleType: 'vat_exempt' },
        ],
      });
    expect(res.status).toBe(403);
  });

  it('accountant: POST /sales-invoices/{hkdInvoiceId}/cancel → 404 (invoice hidden by RLS)', async () => {
    // cancel() loads the invoice first; RLS hides it → 404 before any mutation.
    const res = await request(app.getHttpServer())
      .post(`/sales-invoices/${hkdInvoiceId}/cancel`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(404);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RECEIPTS — accountant cannot see or mutate HKD receipts
  // ═══════════════════════════════════════════════════════════════════════════

  it('accountant: GET /customer-receipts/{smeReceiptId} → 200 (positive control)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/customer-receipts/${smeReceiptId}`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(smeReceiptId);
  });

  it('accountant: GET /customer-receipts/{hkdReceiptId} → 404 (RLS hides it)', async () => {
    // ReceiptsService.get() does a RLS-scoped select; household row hidden → 404.
    const res = await request(app.getHttpServer())
      .get(`/customer-receipts/${hkdReceiptId}`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(404);
  });

  it('accountant: POST /companies/{hkd}/customer-receipts → 403 (app-layer gate)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/customer-receipts`)
      .set('Cookie', acctCookie)
      .send({
        partnerId: hkdPartnerId,
        receiptDate: '2026-04-10',
        periodId: '00000000-0000-0000-0000-000000000000',
        amountMinor: '1000000',
        settlementAccountCode: '111',
      });
    expect(res.status).toBe(403);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AR — accountant sees no household figures in AR
  // ═══════════════════════════════════════════════════════════════════════════

  it('accountant: GET /companies/{sme}/ar → 200 with SME data (positive control)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ar?fiscalYear=2026`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBeGreaterThan(0);
    // The SME partner should appear
    const smeRow = (res.body.rows as Array<{ partnerId: string }>).find(
      (r) => r.partnerId === smePartnerId,
    );
    expect(smeRow).toBeDefined();
    // Household partner must NOT appear
    const hkdRow = (res.body.rows as Array<{ partnerId: string | null }>).find(
      (r) => r.partnerId === hkdPartnerId,
    );
    expect(hkdRow).toBeUndefined();
  });

  it('accountant: GET /companies/{hkd}/ar → 404 (account 131 not visible → no household figures leak)', async () => {
    // ArService.arByCustomer() calls resolve131(companyId) first, which does a
    // RLS-scoped lookup of chart_of_accounts. The accountant cannot see the HKD
    // company's chart of accounts, so resolve131 throws NotFoundException → 404.
    // Crucially: no household AR figures are ever returned in any form.
    const res = await request(app.getHttpServer())
      .get(`/companies/${hkdId}/ar?fiscalYear=2026`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(404);
    // Confirm the response body does not contain household partner id or amounts.
    expect(JSON.stringify(res.body)).not.toContain(hkdPartnerId);
  });

  it('accountant: GET /companies/{hkd}/ar/{hkdPartnerId} → 404 (RLS-hidden or company inaccessible)', async () => {
    // ArService.arForCustomer() tries to load the partner first; under RLS the
    // household partner is not visible → 404.
    const res = await request(app.getHttpServer())
      .get(`/companies/${hkdId}/ar/${hkdPartnerId}?fiscalYear=2026`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(404);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // E-INVOICE — accountant cannot see household e-invoices
  // ═══════════════════════════════════════════════════════════════════════════

  it('accountant: GET /einvoices/{smeEinvoiceId} → 200 (positive control)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/einvoices/${smeEinvoiceId}`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(smeEinvoiceId);
  });

  it('accountant: GET /einvoices/{hkdEinvoiceId} → 404 (RLS hides it)', async () => {
    // EInvoiceService.get() does a RLS-scoped select; household row hidden → 404.
    const res = await request(app.getHttpServer())
      .get(`/einvoices/${hkdEinvoiceId}`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(404);
  });

  it('accountant: POST /sales-invoices/{hkdInvoiceId}/einvoice → 404 (invoice hidden by RLS)', async () => {
    // EInvoiceService.issueForInvoice() loads the sales invoice first via RLS;
    // household invoice is not visible → 404 before any e-invoice write.
    const res = await request(app.getHttpServer())
      .post(`/sales-invoices/${hkdInvoiceId}/einvoice`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(404);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ENGINE PARTNER GUARD — Hardening 1
  // Proves that raw POST /journal-entries with a cross-company partnerId → 422.
  // ═══════════════════════════════════════════════════════════════════════════

  it('admin: POST /journal-entries for SME with household partnerId → 422 (engine guard)', async () => {
    // The document services (sales invoice, receipts) already validate partnerId
    // belongs to the company. But the raw POST /journal-entries endpoint does not —
    // PostingEngine now closes this gap in Hardening 1.
    // hkdPartnerId belongs to hkdId, not smeId. Even as admin (no access 403)
    // the engine-level guard fires and rejects with 422.
    const res = await request(app.getHttpServer())
      .post('/journal-entries')
      .set('Cookie', adminCookie)
      .send({
        companyId: smeId,
        periodId: smePeriodId,
        entryDate: '2026-04-15',
        description: 'Engine partner guard test',
        lines: [
          {
            accountCode: '131',
            debitMinor: '1000000',
            creditMinor: '0',
            partnerId: hkdPartnerId, // belongs to hkdId — must be rejected
          },
          {
            accountCode: '511',
            debitMinor: '0',
            creditMinor: '1000000',
          },
        ],
      });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/partner does not belong to this company/i);
  });

  it('admin: POST /journal-entries for SME with SME partnerId → 201 (engine guard passes)', async () => {
    // Proves that a valid same-company partnerId still works (no false positives).
    const res = await request(app.getHttpServer())
      .post('/journal-entries')
      .set('Cookie', adminCookie)
      .send({
        companyId: smeId,
        periodId: smePeriodId,
        entryDate: '2026-04-16',
        description: 'Engine partner guard OK test',
        lines: [
          {
            accountCode: '131',
            debitMinor: '500000',
            creditMinor: '0',
            partnerId: smePartnerId, // belongs to smeId — must be accepted
          },
          {
            accountCode: '511',
            debitMinor: '0',
            creditMinor: '500000',
          },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.companyId).toBe(smeId);
  });

  it('admin: POST /journal-entries for SME without any partnerId → 201 (guard skipped when no partner)', async () => {
    // Confirms guard is not triggered when no partnerId is set (backward-compat).
    const res = await request(app.getHttpServer())
      .post('/journal-entries')
      .set('Cookie', adminCookie)
      .send({
        companyId: smeId,
        periodId: smePeriodId,
        entryDate: '2026-04-17',
        description: 'No partner ID — guard skipped',
        lines: [
          { accountCode: '111', debitMinor: '100000', creditMinor: '0' },
          { accountCode: '511', debitMinor: '0', creditMinor: '100000' },
        ],
      });
    expect(res.status).toBe(201);
  });
});
