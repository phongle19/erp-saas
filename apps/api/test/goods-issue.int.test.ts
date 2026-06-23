/**
 * Integration tests for goods issue create+post (B6): COGS at weighted-average cost.
 *   - POST /companies/:id/goods-issues
 *   - GET  /goods-issues/:id
 *   - POST /goods-issues/:id/cancel
 *
 * DB-backed, runs as the NOBYPASSRLS `erp` role.
 *
 * Setup:
 *   - seedTwoCompaniesAndUsers → SME (circular_133) + HKD (circular_88)
 *   - Provision CoA for both companies, generate FY2026 for SME.
 *   - Create a material for SME (default inventoryAccountCode '156').
 *   - POST a purchase invoice (20 units @ 1,100,000 each = 22,000,000 total cost)
 *     to establish on-hand stock with known weighted-average cost 1,100,000/unit.
 *
 * Weighted-average tests:
 *   - Issue 5 units → costOut = 5,500,000 (5 × 1,100,000 WA).
 *   - Journal: Dr 632 5,500,000 / Cr 156 5,500,000 — balanced.
 *   - On-hand after: qty 15, value 16,500,000.
 *   - goods_issue.totalCostMinor = 5,500,000.
 *
 * Guard tests:
 *   - Over-issue (100 units) → 422; nothing persisted (issueNo + on-hand unchanged).
 *   - Cancel → journal reversed, stock restored; re-cancel → 422.
 *   - Cross-company material → 422.
 *   - issueNo increments per (company, fiscalYear).
 *   - GET unknown → 404. Unauthenticated → 401.
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

/** SME material (inventoryAccountCode '156'). */
let matId: string;
/** Cross-company material belonging to HKD. */
let hkdMatId: string;
/** Vendor for purchase invoice seed. */
let vendorId: string;

/** Fetch the SME's open period for a given periodNo. */
async function periodId(periodNo: number, fy = 2026): Promise<string> {
  const res = await request(app.getHttpServer())
    .get(`/companies/${smeId}/periods?fiscalYear=${fy}`)
    .set('Cookie', adminCookie);
  const p = res.body.find((x: { periodNo: number }) => x.periodNo === periodNo);
  if (!p) throw new Error(`period ${periodNo}/${fy} not found`);
  return p.id as string;
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
  if (!rows[0]) throw new Error(`CoA account ${code} not found for company ${companyId}`);
  return rows[0].id;
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
  if (!row) return { qty: 0n, value: 0n };
  return { qty: BigInt(row.qty), value: BigInt(row.value) };
}

maybe('Goods issue — COGS at weighted-average cost (B6)', () => {
  beforeAll(async () => {
    app = await makeApp();
    ({ adminCookie, smeId, hkdId } = await seedTwoCompaniesAndUsers(app));

    // Seed VAT rules (needed for the purchase invoice that seeds stock).
    await app.rawSql.unsafe(`
      INSERT INTO tax_rules (rule_type, value, effective_from, effective_to, source_regulation) VALUES
        ('vat_rate',  '10', '2014-01-01', NULL, 'Law on VAT 48/2024/QH15'),
        ('vat_exempt', '0', '2014-01-01', NULL, 'Law on VAT 48/2024/QH15')
      ON CONFLICT DO NOTHING;
    `);

    // Provision CoA for both companies.
    for (const id of [smeId, hkdId]) {
      const prov = await request(app.getHttpServer())
        .post(`/companies/${id}/coa/provision`)
        .set('Cookie', adminCookie);
      expect(prov.status).toBe(200);
    }

    // Generate FY2026 for SME.
    const fyRes = await request(app.getHttpServer())
      .post(`/companies/${smeId}/fiscal-years`)
      .set('Cookie', adminCookie)
      .send({ fiscalYear: 2026 });
    expect(fyRes.status).toBe(200);

    // HKD also needs FY2026 for the cross-company material test.
    const fyHkd = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/fiscal-years`)
      .set('Cookie', adminCookie)
      .send({ fiscalYear: 2026 });
    expect(fyHkd.status).toBe(200);

    // Vendor for the purchase invoice.
    const v = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'V-GI', name: 'NCC xuất kho', partnerType: 'vendor' });
    expect(v.status).toBe(201);
    vendorId = v.body.id as string;

    // SME material (inventoryAccountCode '156' by default).
    const m = await request(app.getHttpServer())
      .post(`/companies/${smeId}/materials`)
      .set('Cookie', adminCookie)
      .send({ code: 'GI-MAT', name: 'Hàng hoá xuất kho' });
    expect(m.status).toBe(201);
    matId = m.body.id as string;

    // HKD cross-company material.
    const mh = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/materials`)
      .set('Cookie', adminCookie)
      .send({ code: 'HKD-MAT', name: 'Hàng HKD' });
    expect(mh.status).toBe(201);
    hkdMatId = mh.body.id as string;

    // Seed stock: purchase 20 units @ 1,100,000 each (total 22,000,000) with
    // vat_exempt so no VAT noise — pure inventory cost 22,000,000.
    // Weighted-average unit cost = 22,000,000 / 20 = 1,100,000.
    const pid = await periodId(1);
    const inv = await request(app.getHttpServer())
      .post(`/companies/${smeId}/purchase-invoices`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: vendorId,
        invoiceDate: '2026-03-01',
        periodId: pid,
        lines: [
          {
            materialId: matId,
            quantity: '20',
            unitCostMinor: '1100000',
            vatRuleType: 'vat_exempt',
          },
        ],
      });
    expect(inv.status).toBe(201);
    expect(inv.body.subtotalMinor).toBe('22000000');

    // Verify on-hand after receipt.
    const oh = await onHand(smeId, matId);
    expect(oh.qty).toBe(20n);
    expect(oh.value).toBe(22000000n);
  });

  afterAll(async () => {
    await closeApp(app);
  });

  // ---------------------------------------------------------------------------
  // Core: issue 5 units → WA costOut = 5 × 1,100,000 = 5,500,000.
  // ---------------------------------------------------------------------------
  it('issue 5 units → costOut 5,500,000; Dr 632 / Cr 156 balanced; on-hand 15 @ 16,500,000', async () => {
    const pid = await periodId(1);
    const beforeOh = await onHand(smeId, matId);
    expect(beforeOh.qty).toBe(20n);
    expect(beforeOh.value).toBe(22000000n);

    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/goods-issues`)
      .set('Cookie', adminCookie)
      .send({
        issueDate: '2026-03-10',
        periodId: pid,
        reason: 'sale',
        description: 'Xuất bán hàng',
        lines: [{ materialId: matId, quantity: '5' }],
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('posted');
    expect(res.body.totalCostMinor).toBe('5500000');
    expect(res.body.issueNo).toBe(1);
    expect(res.body.reason).toBe('sale');

    // Verify the line has the weighted-average costOut.
    const lines: Array<{ costMinor: string; quantity: string }> = res.body.lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]!.costMinor).toBe('5500000');
    expect(lines[0]!.quantity).toBe('5');

    // Journal: Dr 632 / Cr 156, balanced.
    const je = await request(app.getHttpServer())
      .get(`/journal-entries/${res.body.journalEntryId}`)
      .set('Cookie', adminCookie);
    expect(je.status).toBe(200);

    const acct632 = await accountId(smeId, '632');
    const acct156 = await accountId(smeId, '156');

    const jl: Array<{ accountId: string; debitMinor: string; creditMinor: string }> =
      je.body.lines;

    const dr632 = jl.find((l) => l.accountId === acct632)!;
    const cr156 = jl.find((l) => l.accountId === acct156)!;

    expect(dr632).toBeDefined();
    expect(cr156).toBeDefined();
    expect(dr632.debitMinor).toBe('5500000');
    expect(dr632.creditMinor).toBe('0');
    expect(cr156.creditMinor).toBe('5500000');
    expect(cr156.debitMinor).toBe('0');

    // Balanced.
    const totDr = jl.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const totCr = jl.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(totDr).toBe(totCr);
    expect(totDr).toBe(5500000n);

    // On-hand: 15 units, value 16,500,000.
    const afterOh = await onHand(smeId, matId);
    expect(afterOh.qty).toBe(15n);
    expect(afterOh.value).toBe(16500000n);
  });

  // ---------------------------------------------------------------------------
  // Over-issue → 422; nothing persists (issueNo unchanged, on-hand unchanged).
  // ---------------------------------------------------------------------------
  it('over-issue 100 units → 422; issueNo + on-hand unchanged', async () => {
    const pid = await periodId(1);

    const beforeOh = await onHand(smeId, matId);
    const beforeMax = (await app.rawSql.unsafe(
      `SELECT COALESCE(MAX(issue_no),0)::text AS m FROM goods_issues
       WHERE company_id='${smeId}' AND fiscal_year=2026`,
    )) as Array<{ m: string }>;

    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/goods-issues`)
      .set('Cookie', adminCookie)
      .send({
        issueDate: '2026-03-11',
        periodId: pid,
        lines: [{ materialId: matId, quantity: '100' }],
      });

    expect(res.status).toBe(422);

    // issueNo must not have advanced.
    const afterMax = (await app.rawSql.unsafe(
      `SELECT COALESCE(MAX(issue_no),0)::text AS m FROM goods_issues
       WHERE company_id='${smeId}' AND fiscal_year=2026`,
    )) as Array<{ m: string }>;
    expect(afterMax[0]!.m).toBe(beforeMax[0]!.m);

    // On-hand must be unchanged.
    const afterOh = await onHand(smeId, matId);
    expect(afterOh.qty).toBe(beforeOh.qty);
    expect(afterOh.value).toBe(beforeOh.value);
  });

  // ---------------------------------------------------------------------------
  // Cancel → journal reversed (Cr 632 / Dr 156), stock restored; re-cancel 422.
  // ---------------------------------------------------------------------------
  it('cancel reverses GL + restores stock; re-cancel → 422', async () => {
    const pid = await periodId(1);

    const beforeOh = await onHand(smeId, matId);

    // Issue 3 units.
    const issueRes = await request(app.getHttpServer())
      .post(`/companies/${smeId}/goods-issues`)
      .set('Cookie', adminCookie)
      .send({
        issueDate: '2026-03-12',
        periodId: pid,
        reason: 'consumption',
        lines: [{ materialId: matId, quantity: '3' }],
      });
    expect(issueRes.status).toBe(201);

    // costOut for 3 units from WA = 3 × (remaining value / remaining qty).
    // After the first issue (step 1) on-hand is 15 @ 16,500,000 → WA = 1,100,000.
    // So costOut = 3 × 1,100,000 = 3,300,000.
    expect(issueRes.body.totalCostMinor).toBe('3300000');

    const afterIssueOh = await onHand(smeId, matId);
    expect(afterIssueOh.qty).toBe(beforeOh.qty - 3n);
    expect(afterIssueOh.value).toBe(beforeOh.value - 3300000n);

    // Journal should be posted.
    const jeId = issueRes.body.journalEntryId as string;
    const je = await request(app.getHttpServer())
      .get(`/journal-entries/${jeId}`)
      .set('Cookie', adminCookie);
    expect(je.body.status).toBe('posted');

    // Cancel.
    const cancel = await request(app.getHttpServer())
      .post(`/goods-issues/${issueRes.body.id}/cancel`)
      .set('Cookie', adminCookie);
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('cancelled');

    // Original journal entry should now be reversed.
    const jeAfter = await request(app.getHttpServer())
      .get(`/journal-entries/${jeId}`)
      .set('Cookie', adminCookie);
    expect(jeAfter.body.status).toBe('reversed');

    // On-hand restored to before the issue.
    const afterCancelOh = await onHand(smeId, matId);
    expect(afterCancelOh.qty).toBe(beforeOh.qty);
    expect(afterCancelOh.value).toBe(beforeOh.value);

    // Re-cancel → 422.
    const again = await request(app.getHttpServer())
      .post(`/goods-issues/${issueRes.body.id}/cancel`)
      .set('Cookie', adminCookie);
    expect(again.status).toBe(422);
  });

  // ---------------------------------------------------------------------------
  // Cross-company material → 422.
  // ---------------------------------------------------------------------------
  it('material from another company → 422', async () => {
    const pid = await periodId(1);
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/goods-issues`)
      .set('Cookie', adminCookie)
      .send({
        issueDate: '2026-03-15',
        periodId: pid,
        lines: [{ materialId: hkdMatId, quantity: '1' }],
      });
    expect(res.status).toBe(422);
  });

  // ---------------------------------------------------------------------------
  // issueNo increments per (company, fiscalYear).
  // ---------------------------------------------------------------------------
  it('issueNo increments per (company, fiscalYear)', async () => {
    const pid = await periodId(1);

    // On-hand at this point: previous issue(3) was cancelled so we're back to
    // the state after the first (5-unit) issue: 15 units @ 16,500,000.
    // Issue 1 unit.
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/goods-issues`)
      .set('Cookie', adminCookie)
      .send({
        issueDate: '2026-03-16',
        periodId: pid,
        lines: [{ materialId: matId, quantity: '1' }],
      });
    expect(res.status).toBe(201);
    // issueNo 1 = first issue; then we issued again (cancel test = issueNo 2);
    // now this is issueNo 3.
    expect(res.body.issueNo).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // GET unknown → 404.
  // ---------------------------------------------------------------------------
  it('GET unknown goods issue → 404', async () => {
    const res = await request(app.getHttpServer())
      .get('/goods-issues/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // Unauthenticated → 401.
  // ---------------------------------------------------------------------------
  it('unauthenticated request → 401', async () => {
    const pid = await periodId(1);
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/goods-issues`)
      .send({
        issueDate: '2026-03-17',
        periodId: pid,
        lines: [{ materialId: matId, quantity: '1' }],
      });
    expect(res.status).toBe(401);
  });
});
