/**
 * Access-isolation e2e proof — MM surface (Phase 2b B9).
 *
 * Extends the Phase-1 and Phase-2a isolation guarantees to the full
 * materials / inventory / purchasing / AP / vendor-payments surface.
 *
 * Scenario:
 *   - admin creates two companies: SME (circular_133) and Household (circular_88).
 *   - admin provisions CoA + generates FY2026 for BOTH companies.
 *   - admin creates a vendor (partner) for EACH company.
 *   - admin creates a material for EACH company.
 *   - admin posts a purchase invoice to EACH company
 *       (creates stock + AP with real household data, non-trivial).
 *   - admin posts a goods issue for EACH company (COGS, stock decreases).
 *   - admin posts a vendor payment for EACH company (AP decreases).
 *   - an accountant user is granted access to ONLY the SME.
 *
 * What we prove (each assertion documents the actual fail-closed behaviour):
 *
 *   MATERIALS (B4)
 *   ┌─ GET /companies/{hkd}/materials (acct) → 200 but EMPTY (RLS filters silently)
 *   ├─ GET /materials/{hkdMaterialId} (acct) → 404 (RLS hides it)
 *   ├─ POST /companies/{hkd}/materials (acct) → 403 (app-layer gate)
 *   ├─ GET /companies/{sme}/materials (acct) → 200 with SME material (positive control)
 *   └─ GET /materials/{smeMaterialId} (acct) → 200 (positive control)
 *
 *   INVENTORY (B3)
 *   ┌─ GET /companies/{hkd}/inventory (acct) → 403 (app-layer ForbiddenException)
 *   │    assert: no household material code or value in body
 *   ├─ GET /companies/{hkd}/inventory/{hkdMaterialId}/movements (acct) → 403
 *   └─ GET /companies/{sme}/inventory (acct) → 200 with SME data (positive control)
 *
 *   PURCHASE INVOICES (B5)
 *   ┌─ GET /purchase-invoices/{hkdPurchaseId} (acct) → 404 (RLS hides it)
 *   ├─ POST /companies/{hkd}/purchase-invoices (acct) → 403 (app-layer gate)
 *   ├─ POST /purchase-invoices/{hkdPurchaseId}/cancel (acct) → 404
 *   └─ GET /purchase-invoices/{smePurchaseId} (acct) → 200 (positive control)
 *
 *   GOODS ISSUES (B6)
 *   ┌─ GET /goods-issues/{hkdGoodsIssueId} (acct) → 404 (RLS hides it)
 *   ├─ POST /companies/{hkd}/goods-issues (acct) → 403 (app-layer gate)
 *   └─ GET /goods-issues/{smeGoodsIssueId} (acct) → 200 (positive control)
 *
 *   AP (B7)
 *   ┌─ GET /companies/{hkd}/ap (acct) → 404 (account 331 not visible → resolve331 throws)
 *   │    assert: no household figures in body
 *   ├─ GET /companies/{hkd}/ap/{hkdVendorId} (acct) → 404
 *   └─ GET /companies/{sme}/ap (acct) → 200 with SME data (positive control)
 *
 *   VENDOR PAYMENTS (B8)
 *   ┌─ GET /vendor-payments/{hkdVendorPaymentId} (acct) → 404 (RLS hides it)
 *   ├─ POST /companies/{hkd}/vendor-payments (acct) → 403 (app-layer gate)
 *   └─ GET /vendor-payments/{smeVendorPaymentId} (acct) → 200 (positive control)
 *
 *   ADMIN SANITY — admin sees both companies' MM data
 *   ├─ GET materials from both companies → 200 with rows
 *   ├─ GET purchase invoices from both companies → 200
 *   ├─ GET goods issues from both companies → 200
 *   └─ GET vendor payments from both companies → 200
 *
 *   UNAUTHENTICATED — fail-closed baseline (sampling)
 *   ├─ GET /materials/:id → 401
 *   ├─ GET /companies/:id/inventory → 401
 *   ├─ GET /purchase-invoices/:id → 401
 *   ├─ GET /goods-issues/:id → 401
 *   ├─ GET /companies/:id/ap → 401
 *   └─ GET /vendor-payments/:id → 401
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

// Vendor partners
let smeVendorId: string;
let hkdVendorId: string;

// Materials
let smeMaterialId: string;
let hkdMaterialId: string;

// Purchase invoices
let smePurchaseInvoiceId: string;
let hkdPurchaseInvoiceId: string;

// Goods issues
let smeGoodsIssueId: string;
let hkdGoodsIssueId: string;

// Vendor payments
let smeVendorPaymentId: string;
let hkdVendorPaymentId: string;

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

/** Create a purchase invoice (exempt, no VAT noise) for stock + AP. */
async function createPurchaseInvoice(
  companyId: string,
  vendorId: string,
  materialId: string,
  periodId: string,
): Promise<{ id: string }> {
  const res = await request(app.getHttpServer())
    .post(`/companies/${companyId}/purchase-invoices`)
    .set('Cookie', adminCookie)
    .send({
      partnerId: vendorId,
      invoiceDate: '2026-04-01',
      periodId,
      vendorInvoiceNo: `ISO-INV-${companyId.slice(0, 6)}`,
      description: 'Isolation test purchase invoice',
      lines: [
        {
          materialId,
          quantity: '10',
          unitCostMinor: '1000000',
          vatRuleType: 'vat_exempt',
        },
      ],
    });
  if (res.status !== 201) {
    throw new Error(
      `createPurchaseInvoice failed for company ${companyId}: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return { id: res.body.id as string };
}

/** Create a goods issue (issue 3 units) for COGS. */
async function createGoodsIssue(
  companyId: string,
  materialId: string,
  periodId: string,
): Promise<{ id: string }> {
  const res = await request(app.getHttpServer())
    .post(`/companies/${companyId}/goods-issues`)
    .set('Cookie', adminCookie)
    .send({
      issueDate: '2026-04-05',
      periodId,
      reason: 'sale',
      description: 'Isolation test goods issue',
      lines: [{ materialId, quantity: '3' }],
    });
  if (res.status !== 201) {
    throw new Error(
      `createGoodsIssue failed for company ${companyId}: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return { id: res.body.id as string };
}

/** Create a vendor payment settling part of AP. */
async function createVendorPayment(
  companyId: string,
  vendorId: string,
  periodId: string,
): Promise<{ id: string }> {
  const res = await request(app.getHttpServer())
    .post(`/companies/${companyId}/vendor-payments`)
    .set('Cookie', adminCookie)
    .send({
      partnerId: vendorId,
      paymentDate: '2026-04-10',
      periodId,
      amountMinor: '2000000',
      settlementAccountCode: '111',
      description: 'Isolation test vendor payment',
    });
  if (res.status !== 201) {
    throw new Error(
      `createVendorPayment failed for company ${companyId}: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return { id: res.body.id as string };
}

// ─── Test suite ─────────────────────────────────────────────────────────────

maybe('access-isolation: MM surface (Phase 2b B9)', () => {
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
    const smePeriodId = await getPeriodId(smeId, 1);
    const hkdPeriodId = await getPeriodId(hkdId, 1);

    // Create a vendor (partner) for each company
    const smeVendor = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'ISO-V-SME', name: 'SME Vendor', partnerType: 'vendor' });
    if (smeVendor.status !== 201) {
      throw new Error(`create SME vendor failed: ${smeVendor.status} ${JSON.stringify(smeVendor.body)}`);
    }
    smeVendorId = smeVendor.body.id as string;

    const hkdVendor = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'ISO-V-HKD', name: 'HKD Vendor', partnerType: 'vendor' });
    if (hkdVendor.status !== 201) {
      throw new Error(`create HKD vendor failed: ${hkdVendor.status} ${JSON.stringify(hkdVendor.body)}`);
    }
    hkdVendorId = hkdVendor.body.id as string;

    // Create a material for each company
    const smeMat = await request(app.getHttpServer())
      .post(`/companies/${smeId}/materials`)
      .set('Cookie', adminCookie)
      .send({ code: 'ISO-MAT-SME', name: 'SME Material (isolation)' });
    if (smeMat.status !== 201) {
      throw new Error(`create SME material failed: ${smeMat.status} ${JSON.stringify(smeMat.body)}`);
    }
    smeMaterialId = smeMat.body.id as string;

    const hkdMat = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/materials`)
      .set('Cookie', adminCookie)
      .send({ code: 'ISO-MAT-HKD', name: 'HKD Material (isolation)' });
    if (hkdMat.status !== 201) {
      throw new Error(`create HKD material failed: ${hkdMat.status} ${JSON.stringify(hkdMat.body)}`);
    }
    hkdMaterialId = hkdMat.body.id as string;

    // Create purchase invoices (stock + AP) for each company
    const smePurchase = await createPurchaseInvoice(smeId, smeVendorId, smeMaterialId, smePeriodId);
    smePurchaseInvoiceId = smePurchase.id;

    const hkdPurchase = await createPurchaseInvoice(hkdId, hkdVendorId, hkdMaterialId, hkdPeriodId);
    hkdPurchaseInvoiceId = hkdPurchase.id;

    // Create goods issues (COGS) for each company
    const smeGI = await createGoodsIssue(smeId, smeMaterialId, smePeriodId);
    smeGoodsIssueId = smeGI.id;

    const hkdGI = await createGoodsIssue(hkdId, hkdMaterialId, hkdPeriodId);
    hkdGoodsIssueId = hkdGI.id;

    // Create vendor payments for each company
    const smePmt = await createVendorPayment(smeId, smeVendorId, smePeriodId);
    smeVendorPaymentId = smePmt.id;

    const hkdPmt = await createVendorPayment(hkdId, hkdVendorId, hkdPeriodId);
    hkdVendorPaymentId = hkdPmt.id;
  });

  afterAll(async () => {
    await closeApp(app);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // UNAUTHENTICATED — fail-closed baseline
  // ═══════════════════════════════════════════════════════════════════════════

  it('unauthenticated: GET /materials/:id → 401', async () => {
    const res = await request(app.getHttpServer()).get(`/materials/${smeMaterialId}`);
    expect(res.status).toBe(401);
  });

  it('unauthenticated: GET /companies/:id/inventory → 401', async () => {
    const res = await request(app.getHttpServer()).get(`/companies/${smeId}/inventory`);
    expect(res.status).toBe(401);
  });

  it('unauthenticated: GET /purchase-invoices/:id → 401', async () => {
    const res = await request(app.getHttpServer()).get(`/purchase-invoices/${smePurchaseInvoiceId}`);
    expect(res.status).toBe(401);
  });

  it('unauthenticated: GET /goods-issues/:id → 401', async () => {
    const res = await request(app.getHttpServer()).get(`/goods-issues/${smeGoodsIssueId}`);
    expect(res.status).toBe(401);
  });

  it('unauthenticated: GET /companies/:id/ap → 401', async () => {
    const res = await request(app.getHttpServer()).get(
      `/companies/${smeId}/ap?fiscalYear=2026`,
    );
    expect(res.status).toBe(401);
  });

  it('unauthenticated: GET /vendor-payments/:id → 401', async () => {
    const res = await request(app.getHttpServer()).get(`/vendor-payments/${smeVendorPaymentId}`);
    expect(res.status).toBe(401);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ADMIN SANITY — admin sees both companies' MM data
  // ═══════════════════════════════════════════════════════════════════════════

  it('admin: GET SME materials → 200 with smeMaterialId present', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/materials`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(smeMaterialId);
  });

  it('admin: GET HKD materials → 200 with hkdMaterialId present', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${hkdId}/materials`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(hkdMaterialId);
  });

  it('admin: GET SME purchase invoice → 200', async () => {
    const res = await request(app.getHttpServer())
      .get(`/purchase-invoices/${smePurchaseInvoiceId}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(smePurchaseInvoiceId);
    expect(res.body.companyId).toBe(smeId);
  });

  it('admin: GET HKD purchase invoice → 200 (positive control)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/purchase-invoices/${hkdPurchaseInvoiceId}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(hkdPurchaseInvoiceId);
    expect(res.body.companyId).toBe(hkdId);
  });

  it('admin: GET HKD goods issue → 200 (positive control)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/goods-issues/${hkdGoodsIssueId}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(hkdGoodsIssueId);
    expect(res.body.companyId).toBe(hkdId);
  });

  it('admin: GET HKD vendor payment → 200 (positive control)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/vendor-payments/${hkdVendorPaymentId}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(hkdVendorPaymentId);
    expect(res.body.companyId).toBe(hkdId);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // MATERIALS — accountant can only see SME materials
  // ═══════════════════════════════════════════════════════════════════════════

  it('accountant: GET /companies/{sme}/materials → 200 with SME material (positive control)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/materials`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(smeMaterialId);
    // Household material must NOT appear
    expect(ids).not.toContain(hkdMaterialId);
  });

  it('accountant: GET /companies/{hkd}/materials → 200 but EMPTY (no household materials leak)', async () => {
    // RLS filters materials by accessible companies; the accountant has no access
    // to hkdId so all household materials are hidden. The list returns empty (not 404).
    const res = await request(app.getHttpServer())
      .get(`/companies/${hkdId}/materials`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
    // Household material must not appear in any form
    expect(JSON.stringify(res.body)).not.toContain(hkdMaterialId);
  });

  it('accountant: GET /materials/{hkdMaterialId} → 404 (RLS hides it)', async () => {
    // MaterialsService.get() does a RLS-scoped select; household material is invisible → 404.
    const res = await request(app.getHttpServer())
      .get(`/materials/${hkdMaterialId}`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(404);
  });

  it('accountant: GET /materials/{smeMaterialId} → 200 (positive control)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/materials/${smeMaterialId}`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(smeMaterialId);
  });

  it('accountant: POST /companies/{hkd}/materials → 403 (app-layer gate)', async () => {
    // MaterialsService.create() checks accessibleCompanies before any DB write.
    const res = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/materials`)
      .set('Cookie', acctCookie)
      .send({ code: 'X99', name: 'Attempted cross-write' });
    expect(res.status).toBe(403);
  });

  it('accountant: POST /companies/{sme}/materials → 201 (positive control)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/materials`)
      .set('Cookie', acctCookie)
      .send({ code: 'ACCT-NEW-MAT', name: 'Accountant new material' });
    expect(res.status).toBe(201);
    expect(res.body.companyId).toBe(smeId);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INVENTORY — accountant cannot see HKD inventory
  // ═══════════════════════════════════════════════════════════════════════════

  it('accountant: GET /companies/{sme}/inventory → 200 with SME data (positive control)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/inventory`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    // SME material must appear (has movements from the purchase + goods issue)
    const rows = res.body.rows as Array<{ materialId: string }>;
    const smeRow = rows.find((r) => r.materialId === smeMaterialId);
    expect(smeRow).toBeDefined();
    // Household material must NOT appear
    const hkdRow = rows.find((r) => r.materialId === hkdMaterialId);
    expect(hkdRow).toBeUndefined();
  });

  it('accountant: GET /companies/{hkd}/inventory → 403 (app-layer ForbiddenException; no household figures leak)', async () => {
    // InventoryService.valuationReport() checks accessibleCompanies before any DB read;
    // the accountant does not have hkdId → ForbiddenException (403).
    // Crucially: no household inventory figures are ever returned in any form.
    const res = await request(app.getHttpServer())
      .get(`/companies/${hkdId}/inventory`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(403);
    // Confirm the response body does not contain household material id or values.
    expect(JSON.stringify(res.body)).not.toContain(hkdMaterialId);
  });

  it('accountant: GET /companies/{hkd}/inventory/{hkdMaterialId}/movements → 403 (app-layer guard)', async () => {
    // InventoryService.movements() checks accessibleCompanies; household company denied → 403.
    const res = await request(app.getHttpServer())
      .get(`/companies/${hkdId}/inventory/${hkdMaterialId}/movements`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(hkdMaterialId);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PURCHASE INVOICES — accountant cannot see or mutate HKD invoices
  // ═══════════════════════════════════════════════════════════════════════════

  it('accountant: GET /purchase-invoices/{smePurchaseInvoiceId} → 200 (positive control)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/purchase-invoices/${smePurchaseInvoiceId}`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(smePurchaseInvoiceId);
    expect(res.body.companyId).toBe(smeId);
  });

  it('accountant: GET /purchase-invoices/{hkdPurchaseInvoiceId} → 404 (RLS hides it)', async () => {
    // PurchaseInvoiceService.get() does a RLS-scoped select; household row hidden → 404.
    const res = await request(app.getHttpServer())
      .get(`/purchase-invoices/${hkdPurchaseInvoiceId}`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(404);
  });

  it('accountant: POST /companies/{hkd}/purchase-invoices → 403 (app-layer gate)', async () => {
    // PostingEngine checks accessibleCompanies before any DB write.
    const res = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/purchase-invoices`)
      .set('Cookie', acctCookie)
      .send({
        partnerId: hkdVendorId,
        invoiceDate: '2026-04-15',
        periodId: '00000000-0000-0000-0000-000000000000',
        lines: [
          {
            materialId: hkdMaterialId,
            quantity: '1',
            unitCostMinor: '1000000',
            vatRuleType: 'vat_exempt',
          },
        ],
      });
    expect(res.status).toBe(403);
  });

  it('accountant: POST /purchase-invoices/{hkdPurchaseInvoiceId}/cancel → 404 (invoice hidden by RLS)', async () => {
    // cancel() loads the invoice first; RLS hides it → 404 before any mutation.
    const res = await request(app.getHttpServer())
      .post(`/purchase-invoices/${hkdPurchaseInvoiceId}/cancel`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(404);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GOODS ISSUES — accountant cannot see or mutate HKD goods issues
  // ═══════════════════════════════════════════════════════════════════════════

  it('accountant: GET /goods-issues/{smeGoodsIssueId} → 200 (positive control)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/goods-issues/${smeGoodsIssueId}`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(smeGoodsIssueId);
    expect(res.body.companyId).toBe(smeId);
  });

  it('accountant: GET /goods-issues/{hkdGoodsIssueId} → 404 (RLS hides it)', async () => {
    // GoodsIssueService.get() does a RLS-scoped select; household row hidden → 404.
    const res = await request(app.getHttpServer())
      .get(`/goods-issues/${hkdGoodsIssueId}`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(404);
  });

  it('accountant: POST /companies/{hkd}/goods-issues → 403 (app-layer gate)', async () => {
    // PostingEngine checks accessibleCompanies before any DB write.
    const res = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/goods-issues`)
      .set('Cookie', acctCookie)
      .send({
        issueDate: '2026-04-16',
        periodId: '00000000-0000-0000-0000-000000000000',
        lines: [{ materialId: hkdMaterialId, quantity: '1' }],
      });
    expect(res.status).toBe(403);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AP — accountant sees no household figures in AP
  // ═══════════════════════════════════════════════════════════════════════════

  it('accountant: GET /companies/{sme}/ap → 200 with SME data (positive control)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ap?fiscalYear=2026`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    // SME vendor should appear in AP rows
    const rows = res.body.rows as Array<{ partnerId: string | null }>;
    const smeRow = rows.find((r) => r.partnerId === smeVendorId);
    expect(smeRow).toBeDefined();
    // Household vendor must NOT appear
    const hkdRow = rows.find((r) => r.partnerId === hkdVendorId);
    expect(hkdRow).toBeUndefined();
  });

  it('accountant: GET /companies/{hkd}/ap → 404 (account 331 not visible → no household figures leak)', async () => {
    // ApService.apByVendor() calls resolve331(companyId) first, which does a
    // RLS-scoped lookup of chart_of_accounts. The accountant cannot see the HKD
    // company's chart of accounts, so resolve331 throws NotFoundException → 404.
    // Crucially: no household AP figures are ever returned in any form.
    const res = await request(app.getHttpServer())
      .get(`/companies/${hkdId}/ap?fiscalYear=2026`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(404);
    // Confirm the response body does not contain household vendor id or amounts.
    expect(JSON.stringify(res.body)).not.toContain(hkdVendorId);
  });

  it('accountant: GET /companies/{hkd}/ap/{hkdVendorId} → 404 (RLS-hidden or company inaccessible)', async () => {
    // ApService.apForVendor() tries to load the partner first; under RLS the
    // household partner is not visible → 404.
    const res = await request(app.getHttpServer())
      .get(`/companies/${hkdId}/ap/${hkdVendorId}?fiscalYear=2026`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(404);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // VENDOR PAYMENTS — accountant cannot see or mutate HKD vendor payments
  // ═══════════════════════════════════════════════════════════════════════════

  it('accountant: GET /vendor-payments/{smeVendorPaymentId} → 200 (positive control)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/vendor-payments/${smeVendorPaymentId}`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(smeVendorPaymentId);
    expect(res.body.companyId).toBe(smeId);
  });

  it('accountant: GET /vendor-payments/{hkdVendorPaymentId} → 404 (RLS hides it)', async () => {
    // VendorPaymentService.get() does a RLS-scoped select; household row hidden → 404.
    const res = await request(app.getHttpServer())
      .get(`/vendor-payments/${hkdVendorPaymentId}`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(404);
  });

  it('accountant: POST /companies/{hkd}/vendor-payments → 403 (app-layer gate)', async () => {
    // PostingEngine checks accessibleCompanies before any DB write.
    const res = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/vendor-payments`)
      .set('Cookie', acctCookie)
      .send({
        partnerId: hkdVendorId,
        paymentDate: '2026-04-17',
        periodId: '00000000-0000-0000-0000-000000000000',
        amountMinor: '1000000',
        settlementAccountCode: '111',
      });
    expect(res.status).toBe(403);
  });
});
