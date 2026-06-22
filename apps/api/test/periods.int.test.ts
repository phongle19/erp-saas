/**
 * Integration tests for:
 *   - CoA provisioning (POST /companies/:id/coa/provision)
 *   - Account listing (GET /companies/:id/accounts)
 *   - Fiscal-year generation (POST /companies/:id/fiscal-years)
 *   - Period listing (GET /companies/:id/periods?fiscalYear=)
 *   - Period transitions (close / reopen / lock)
 *
 * Runs against a real Postgres DB as the NOBYPASSRLS `erp` role.
 * Gated on TEST_DATABASE_URL / DATABASE_URL.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { schema } from '@erp/db';
import { makeApp, closeApp, type TestApp } from './helpers/make-app.js';
import { seedTwoCompaniesAndUsers } from './helpers/seed-test.js';
import { runInTenantTx } from '../src/db/tenant-tx.js';
import { currentTx } from '../src/db/tx-context.js';

const DB_URL = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const maybe = DB_URL ? describe : describe.skip;

let app: TestApp;
let adminCookie: string;
let acctCookie: string;
let smeId: string; // circular_133 company

maybe('CoA provisioning + fiscal-year/period generation', () => {
  beforeAll(async () => {
    app = await makeApp();
    ({ adminCookie, acctCookie, smeId } = await seedTwoCompaniesAndUsers(app));

    // Set the SME company's fiscalYearStartMonth to 4 (April) via an admin-context
    // tenant tx (required because FORCE RLS blocks writes without GUCs).
    await runInTenantTx(
      { userId: null, isAdmin: true, accessibleCompanies: [] },
      async () => {
        const { db } = currentTx();
        await db
          .update(schema.companies)
          .set({ fiscalYearStartMonth: 4 })
          .where(eq(schema.companies.id, smeId));
      },
    );
  });

  afterAll(async () => {
    await closeApp(app);
  });

  // -------------------------------------------------------------------------
  // CoA provisioning
  // -------------------------------------------------------------------------

  it('provisions circular_133 CoA for the SME company', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/coa/provision`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.inserted).toBeGreaterThan(0);
  });

  it('GET /companies/:id/accounts returns accounts including 111, 511, 632', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/accounts`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    const codes = res.body.map((a: { code: string }) => a.code);
    expect(codes).toContain('111');
    expect(codes).toContain('511');
    expect(codes).toContain('632');
  });

  it('accounts are returned ordered by code', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/accounts`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    const codes: string[] = res.body.map((a: { code: string }) => a.code);
    const sorted = [...codes].sort((a, b) => a.localeCompare(b));
    expect(codes).toEqual(sorted);
  });

  it('provisioning again is idempotent (count unchanged, inserted=0)', async () => {
    const countBefore = await app.db
      .select()
      .from(schema.chartOfAccounts)
      .where(eq(schema.chartOfAccounts.companyId, smeId))
      .then((rows) => rows.length);

    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/coa/provision`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(0);

    const countAfter = await app.db
      .select()
      .from(schema.chartOfAccounts)
      .where(eq(schema.chartOfAccounts.companyId, smeId))
      .then((rows) => rows.length);

    expect(countAfter).toBe(countBefore);
  });

  it('non-admin cannot provision (403)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/coa/provision`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(403);
  });

  // -------------------------------------------------------------------------
  // Fiscal-year period generation
  // -------------------------------------------------------------------------

  it('generates FY2026 with 12 regular periods (startMonth=4)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/fiscal-years`)
      .set('Cookie', adminCookie)
      .send({ fiscalYear: 2026 });

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(12);
  });

  it('period 1 = 2026-04-01..2026-04-30 (startMonth=4)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/periods?fiscalYear=2026`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    const periods = res.body as Array<{
      periodNo: number;
      startDate: string;
      endDate: string;
      periodType: string;
      nameVi: string;
    }>;

    const p1 = periods.find((p) => p.periodNo === 1);
    expect(p1).toBeDefined();
    expect(p1!.startDate).toBe('2026-04-01');
    expect(p1!.endDate).toBe('2026-04-30');
    expect(p1!.periodType).toBe('regular');
    expect(p1!.nameVi).toBe('Tháng 4/2026');
  });

  it('period 9 = 2026-12-01..2026-12-31', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/periods?fiscalYear=2026`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    const periods = res.body as Array<{ periodNo: number; startDate: string; endDate: string }>;

    const p9 = periods.find((p) => p.periodNo === 9);
    expect(p9).toBeDefined();
    expect(p9!.startDate).toBe('2026-12-01');
    expect(p9!.endDate).toBe('2026-12-31');
  });

  it('period 10 = 2027-01-01..2027-01-31 (year rollover)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/periods?fiscalYear=2026`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    const periods = res.body as Array<{ periodNo: number; startDate: string; endDate: string }>;

    const p10 = periods.find((p) => p.periodNo === 10);
    expect(p10).toBeDefined();
    expect(p10!.startDate).toBe('2027-01-01');
    expect(p10!.endDate).toBe('2027-01-31');
  });

  it('period 12 = 2027-03-01..2027-03-31', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/periods?fiscalYear=2026`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    const periods = res.body as Array<{ periodNo: number; startDate: string; endDate: string }>;

    const p12 = periods.find((p) => p.periodNo === 12);
    expect(p12).toBeDefined();
    expect(p12!.startDate).toBe('2027-03-01');
    expect(p12!.endDate).toBe('2027-03-31');
  });

  it('only 12 regular periods exist (no specials yet)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/periods?fiscalYear=2026`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(12);
    expect(res.body.every((p: { periodType: string }) => p.periodType === 'regular')).toBe(true);
  });

  it('generate special periods 13/14/15', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/fiscal-years`)
      .set('Cookie', adminCookie)
      .send({
        fiscalYear: 2026,
        specialPeriods: [
          { periodNo: 13, purpose: 'closing', nameVi: 'Điều chỉnh khóa sổ cuối năm' },
          { periodNo: 14, purpose: 'audit', nameVi: 'Điều chỉnh kiểm toán' },
          { periodNo: 15, purpose: 'retrospective', nameVi: 'Điều chỉnh hồi tố' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(3);
  });

  it('special periods 13/14/15 exist with correct type and purposes', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/periods?fiscalYear=2026`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    const periods = res.body as Array<{
      periodNo: number;
      periodType: string;
      purpose: string;
      nameVi: string;
      startDate: string | null;
      endDate: string | null;
    }>;

    expect(periods.length).toBe(15);

    const p13 = periods.find((p) => p.periodNo === 13);
    expect(p13).toBeDefined();
    expect(p13!.periodType).toBe('special');
    expect(p13!.purpose).toBe('closing');
    expect(p13!.nameVi).toBe('Điều chỉnh khóa sổ cuối năm');
    expect(p13!.startDate).toBeNull();
    expect(p13!.endDate).toBeNull();

    const p14 = periods.find((p) => p.periodNo === 14);
    expect(p14).toBeDefined();
    expect(p14!.periodType).toBe('special');
    expect(p14!.purpose).toBe('audit');

    const p15 = periods.find((p) => p.periodNo === 15);
    expect(p15).toBeDefined();
    expect(p15!.periodType).toBe('special');
    expect(p15!.purpose).toBe('retrospective');
  });

  it('re-running generateFiscalYear with special periods is idempotent (created=0)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/fiscal-years`)
      .set('Cookie', adminCookie)
      .send({
        fiscalYear: 2026,
        specialPeriods: [
          { periodNo: 13, purpose: 'closing', nameVi: 'Điều chỉnh khóa sổ cuối năm' },
          { periodNo: 14, purpose: 'audit', nameVi: 'Điều chỉnh kiểm toán' },
          { periodNo: 15, purpose: 'retrospective', nameVi: 'Điều chỉnh hồi tố' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Period transitions
  // -------------------------------------------------------------------------

  let period1Id: string;

  it('resolve period 1 id', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/periods?fiscalYear=2026`)
      .set('Cookie', adminCookie);

    const p1 = res.body.find((p: { periodNo: number }) => p.periodNo === 1);
    period1Id = p1.id;
    expect(period1Id).toBeTruthy();
  });

  it('close period → status becomes closed, closedAt is set', async () => {
    const res = await request(app.getHttpServer())
      .post(`/periods/${period1Id}/close`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('closed');
    expect(res.body.closedAt).not.toBeNull();
  });

  it('reopen period → status back to open', async () => {
    const res = await request(app.getHttpServer())
      .post(`/periods/${period1Id}/reopen`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('open');
  });

  it('close again → status closed', async () => {
    const res = await request(app.getHttpServer())
      .post(`/periods/${period1Id}/close`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('closed');
  });

  it('lock period → status becomes locked', async () => {
    const res = await request(app.getHttpServer())
      .post(`/periods/${period1Id}/lock`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('locked');
  });

  it('reopen of a locked period is rejected (403)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/periods/${period1Id}/reopen`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(403);
  });

  it('non-admin cannot close a period (403)', async () => {
    // Find another open period for this test.
    const listRes = await request(app.getHttpServer())
      .get(`/companies/${smeId}/periods?fiscalYear=2026`)
      .set('Cookie', adminCookie);
    const p2 = listRes.body.find((p: { periodNo: number }) => p.periodNo === 2);

    const res = await request(app.getHttpServer())
      .post(`/periods/${p2.id}/close`)
      .set('Cookie', acctCookie);

    expect(res.status).toBe(403);
  });
});
