/**
 * Integration tests for the weighted-average inventory valuation service — Phase 2b Task B3.
 *
 * Proves:
 *   - receipt 10 @ 10,000,000 then receipt 10 @ 12,000,000
 *       → on-hand qty 20, value 22,000,000, avg 1,100,000
 *   - issue 5 → costOut 5,500,000; on-hand qty 15, value 16,500,000
 *   - issue 20 (over-issue) → throws UnprocessableEntityException (422 via HTTP)
 *   - valuationReport total = Σ material values; reconciles across materials
 *   - movements ledger lists all 3 movements in order
 *   - GET /companies/:id/inventory returns valuation (AuthGuard)
 *   - GET /companies/:id/inventory/:materialId/movements returns ledger
 *   - RLS: another company's material/movements not visible
 *
 * Runs against real Postgres as the NOBYPASSRLS `erp` role (RLS is enforced).
 * Gated on TEST_DATABASE_URL / DATABASE_URL.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { schema } from '@erp/db';
import { makeApp, closeApp, type TestApp } from './helpers/make-app.js';
import { seedTwoCompaniesAndUsers } from './helpers/seed-test.js';
import { runInTenantTx } from '../src/db/tenant-tx.js';
import { currentTx } from '../src/db/tx-context.js';
import { InventoryService } from '../src/inventory/inventory.service.js';

const DB_URL = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const maybe = DB_URL ? describe : describe.skip;

let app: TestApp;
let adminCookie: string;
let acctCookie: string;
let smeId: string;
let hkdId: string;
let materialId: string;   // M001 in SME company
let material2Id: string;  // M002 in SME company (for valuationReport total test)
let hkdMaterialId: string; // M001 in HKD company (isolation test)
let periodId: string;

// Shared UUID for fake journal/doc references (no real journal needed for B3 — B5/B6 will wire that)
const FAKE_JOURNAL_ID = '00000000-0000-0000-0000-000000000001';
const FAKE_DOC_ID = '00000000-0000-0000-0000-000000000002';

/** Fetch the first open period for the SME company (FY2026 P1). */
async function getPeriodId(): Promise<string> {
  const res = await request(app.getHttpServer())
    .get(`/companies/${smeId}/periods?fiscalYear=2026`)
    .set('Cookie', adminCookie);
  if (res.status !== 200) throw new Error(`periods failed: ${res.status} ${JSON.stringify(res.body)}`);
  const p = res.body.find((x: { periodNo: number }) => x.periodNo === 1);
  if (!p) throw new Error('period 1/2026 not found');
  return p.id as string;
}

maybe('Inventory valuation service (B3)', () => {
  beforeAll(async () => {
    app = await makeApp();
    ({ adminCookie, acctCookie, smeId, hkdId } = await seedTwoCompaniesAndUsers(app));

    // Provision CoA for both companies (required for FY/period generation).
    const provSme = await request(app.getHttpServer())
      .post(`/companies/${smeId}/coa/provision`)
      .set('Cookie', adminCookie);
    expect(provSme.status).toBe(200);

    const provHkd = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/coa/provision`)
      .set('Cookie', adminCookie);
    expect(provHkd.status).toBe(200);

    // FY2026 for SME.
    const fySme = await request(app.getHttpServer())
      .post(`/companies/${smeId}/fiscal-years`)
      .set('Cookie', adminCookie)
      .send({ fiscalYear: 2026 });
    expect(fySme.status).toBe(200);

    // FY2026 for HKD (needed for the material's periodId foreign key).
    const fyHkd = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/fiscal-years`)
      .set('Cookie', adminCookie)
      .send({ fiscalYear: 2026 });
    expect(fyHkd.status).toBe(200);

    periodId = await getPeriodId();

    // Create materials via direct DB insert in an admin tenant tx (the material
    // master endpoint B4 doesn't exist yet — B3 only needs the FK to exist).
    await runInTenantTx(
      { userId: null, isAdmin: true, accessibleCompanies: [] },
      async () => {
        const { db } = currentTx();

        // M001 in SME
        const [m1] = await db
          .insert(schema.materials)
          .values({
            companyId: smeId,
            code: 'M001',
            name: 'Raw material 001',
            unit: 'kg',
            inventoryAccountCode: '156',
          })
          .returning();
        materialId = m1!.id;

        // M002 in SME (second material for valuationReport aggregate test)
        const [m2] = await db
          .insert(schema.materials)
          .values({
            companyId: smeId,
            code: 'M002',
            name: 'Raw material 002',
            unit: 'pcs',
            inventoryAccountCode: '156',
          })
          .returning();
        material2Id = m2!.id;

        // M001 in HKD (isolation test)
        const [mh] = await db
          .insert(schema.materials)
          .values({
            companyId: hkdId,
            code: 'H001',
            name: 'HKD material',
            unit: 'kg',
            inventoryAccountCode: '156',
          })
          .returning();
        hkdMaterialId = mh!.id;
      },
    );
  });

  afterAll(async () => {
    await closeApp(app);
  });

  // ---------------------------------------------------------------------------
  // Helper: instantiate the service and call it inside a fresh admin tenant tx.
  // ---------------------------------------------------------------------------
  const svc = () => new InventoryService();

  async function adminTx<T>(fn: (s: InventoryService) => Promise<T>): Promise<T> {
    return runInTenantTx(
      { userId: null, isAdmin: true, accessibleCompanies: [] },
      () => fn(svc()),
    );
  }

  // ---------------------------------------------------------------------------
  // Valuation math
  // ---------------------------------------------------------------------------

  it('receipt 1: 10 units @ total 10,000,000 → qty 10, value 10,000,000', async () => {
    const result = await adminTx((s) =>
      s.applyReceipt({
        materialId,
        quantity: 10n,
        cost: 10_000_000n,
        sourceDocType: 'test',
        sourceDocId: FAKE_DOC_ID,
        journalEntryId: FAKE_JOURNAL_ID,
        periodId,
        movementDate: '2026-01-15',
        companyId: smeId,
      }),
    );
    expect(result.balanceQty).toBe(10n);
    expect(result.balanceValue).toBe(10_000_000n);
  });

  it('receipt 2: 10 more units @ total 12,000,000 → qty 20, value 22,000,000', async () => {
    const result = await adminTx((s) =>
      s.applyReceipt({
        materialId,
        quantity: 10n,
        cost: 12_000_000n,
        sourceDocType: 'test',
        sourceDocId: FAKE_DOC_ID,
        journalEntryId: FAKE_JOURNAL_ID,
        periodId,
        movementDate: '2026-01-20',
        companyId: smeId,
      }),
    );
    expect(result.balanceQty).toBe(20n);
    expect(result.balanceValue).toBe(22_000_000n);
  });

  it('onHand: qty 20, value 22,000,000, avgUnitCost 1,100,000', async () => {
    const onHand = await adminTx((s) => s.onHand(smeId, materialId));
    expect(onHand.qty).toBe(20n);
    expect(onHand.value).toBe(22_000_000n);
    expect(onHand.avgUnitCost).toBe(1_100_000n);
  });

  it('issue 5 → costOut 5,500,000; on-hand qty 15, value 16,500,000', async () => {
    const result = await adminTx((s) =>
      s.applyIssue({
        materialId,
        quantity: 5n,
        sourceDocType: 'test',
        sourceDocId: FAKE_DOC_ID,
        journalEntryId: FAKE_JOURNAL_ID,
        periodId,
        movementDate: '2026-01-25',
        companyId: smeId,
      }),
    );
    expect(result.costOut).toBe(5_500_000n);
    expect(result.balanceQty).toBe(15n);
    expect(result.balanceValue).toBe(16_500_000n);
  });

  it('over-issue (20 > 15 on-hand) throws UnprocessableEntityException', async () => {
    await expect(
      adminTx((s) =>
        s.applyIssue({
          materialId,
          quantity: 20n,
          sourceDocType: 'test',
          sourceDocId: FAKE_DOC_ID,
          journalEntryId: FAKE_JOURNAL_ID,
          periodId,
          movementDate: '2026-01-26',
          companyId: smeId,
        }),
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('movements ledger lists 3 movements in chronological order', async () => {
    const mvts = await adminTx((s) => s.movements(smeId, materialId));
    expect(mvts).toHaveLength(3);
    expect(mvts[0]!.movementType).toBe('receipt');
    expect(mvts[0]!.quantity).toBe('10');
    expect(mvts[0]!.totalCostMinor).toBe('10000000');
    expect(mvts[0]!.balanceQtyAfter).toBe('10');
    expect(mvts[0]!.balanceValueAfter).toBe('10000000');

    expect(mvts[1]!.movementType).toBe('receipt');
    expect(mvts[1]!.quantity).toBe('10');
    expect(mvts[1]!.totalCostMinor).toBe('12000000');
    expect(mvts[1]!.balanceQtyAfter).toBe('20');
    expect(mvts[1]!.balanceValueAfter).toBe('22000000');

    expect(mvts[2]!.movementType).toBe('issue');
    expect(mvts[2]!.quantity).toBe('5');
    expect(mvts[2]!.totalCostMinor).toBe('5500000');
    expect(mvts[2]!.balanceQtyAfter).toBe('15');
    expect(mvts[2]!.balanceValueAfter).toBe('16500000');
  });

  it('valuationReport: M001 value 16,500,000; M002 (no movements) excluded; totalValue matches', async () => {
    // M002 has no movements → should not appear in the report.
    const report = await adminTx((s) => s.valuationReport(smeId));
    const m1Row = report.rows.find((r) => r.materialId === materialId);
    const m2Row = report.rows.find((r) => r.materialId === material2Id);

    expect(m1Row).toBeDefined();
    expect(m1Row!.qty).toBe('15');
    expect(m1Row!.value).toBe('16500000');
    expect(m1Row!.avgUnitCost).toBe('1100000');
    expect(m2Row).toBeUndefined();

    // totalValue = 16,500,000 (only M001 has movements).
    expect(report.totalValue).toBe('16500000');
  });

  it('valuationReport totalValue reconciles when M002 also has receipts', async () => {
    // Add a receipt for M002.
    await adminTx((s) =>
      s.applyReceipt({
        materialId: material2Id,
        quantity: 100n,
        cost: 5_000_000n,
        sourceDocType: 'test',
        sourceDocId: FAKE_DOC_ID,
        journalEntryId: FAKE_JOURNAL_ID,
        periodId,
        movementDate: '2026-01-28',
        companyId: smeId,
      }),
    );

    const report = await adminTx((s) => s.valuationReport(smeId));
    const m1Row = report.rows.find((r) => r.materialId === materialId);
    const m2Row = report.rows.find((r) => r.materialId === material2Id);
    expect(m1Row).toBeDefined();
    expect(m2Row).toBeDefined();
    expect(m2Row!.value).toBe('5000000');

    // totalValue = 16,500,000 + 5,000,000 = 21,500,000
    expect(report.totalValue).toBe('21500000');
  });

  // ---------------------------------------------------------------------------
  // REST endpoints (AuthGuard)
  // ---------------------------------------------------------------------------

  it('GET /companies/:id/inventory returns 401 without auth', async () => {
    const res = await request(app.getHttpServer()).get(`/companies/${smeId}/inventory`);
    expect(res.status).toBe(401);
  });

  it('GET /companies/:id/inventory returns valuation report for authenticated user', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/inventory`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('rows');
    expect(res.body).toHaveProperty('totalValue');
    expect(Array.isArray(res.body.rows)).toBe(true);
    // At least M001 should appear.
    const m1 = res.body.rows.find((r: { materialId: string }) => r.materialId === materialId);
    expect(m1).toBeDefined();
    expect(m1.value).toBe('16500000');
  });

  it('GET /companies/:id/inventory/:materialId/movements returns movement ledger', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/inventory/${materialId}/movements`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(3);
  });

  it('GET /companies/:id/inventory/:materialId/movements returns 401 without auth', async () => {
    const res = await request(app.getHttpServer()).get(
      `/companies/${smeId}/inventory/${materialId}/movements`,
    );
    expect(res.status).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // RLS isolation: accountant (acct) can only see SME, not HKD
  // ---------------------------------------------------------------------------

  it('accountant can read SME inventory', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/inventory`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
  });

  it('accountant cannot read HKD inventory (403 from app-layer guard)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${hkdId}/inventory`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(403);
  });

  it('HKD movements not visible via SME company scope (movements returns empty)', async () => {
    // The HKD material FK is under hkdId. Querying via smeId for hkdMaterialId
    // should return an empty array (RLS scopes movements to accessible companies).
    // Note: the service filters by companyId=smeId, so this will return [] regardless.
    const mvts = await adminTx((s) => s.movements(smeId, hkdMaterialId));
    expect(mvts).toHaveLength(0);
  });

  it('HKD material movements not visible in SME valuationReport', async () => {
    // First add a receipt for hkdMaterialId via HKD admin tx.
    await runInTenantTx(
      { userId: null, isAdmin: true, accessibleCompanies: [] },
      async () => {
        const hkdPeriodRes = await request(app.getHttpServer())
          .get(`/companies/${hkdId}/periods?fiscalYear=2026`)
          .set('Cookie', adminCookie);
        const hkdPeriod = hkdPeriodRes.body.find((x: { periodNo: number }) => x.periodNo === 1);

        const { db } = currentTx();
        await db.insert(schema.inventoryMovements).values({
          companyId: hkdId,
          materialId: hkdMaterialId,
          movementType: 'receipt',
          quantity: 50n,
          unitCostMinor: 200_000n,
          totalCostMinor: 10_000_000n,
          balanceQtyAfter: 50n,
          balanceValueAfter: 10_000_000n,
          sourceDocType: 'test',
          sourceDocId: FAKE_DOC_ID,
          journalEntryId: FAKE_JOURNAL_ID,
          movementDate: '2026-01-10',
          periodId: hkdPeriod?.id ?? periodId,
        });
      },
    );

    // HKD material should NOT appear in SME's valuation report.
    const report = await adminTx((s) => s.valuationReport(smeId));
    const hkdRow = report.rows.find((r) => r.materialId === hkdMaterialId);
    expect(hkdRow).toBeUndefined();
  });
});
