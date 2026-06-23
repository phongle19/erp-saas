/**
 * Integration tests — business partner master (A4).
 *
 * Covers:
 *   - admin creates a customer for the SME → 201 with id
 *   - list returns the created partner
 *   - get by id returns it
 *   - duplicate code for same company → 409 Conflict
 *   - accountant (granted SME) can create/list SME's partners → 201/200
 *   - accountant creating a partner for the Household (not granted) → 403
 *   - accountant listing the Household's partners → empty array (RLS scoping, no leak)
 *   - unauthenticated → 401
 *
 * Runs against a real Postgres DB as the NOBYPASSRLS `erp` role.
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

maybe('partners master (A4)', () => {
  beforeAll(async () => {
    app = await makeApp();
    ({ adminCookie, acctCookie, smeId, hkdId } = await seedTwoCompaniesAndUsers(app));
  });

  afterAll(async () => {
    await closeApp(app);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // UNAUTHENTICATED — fail-closed baseline
  // ═══════════════════════════════════════════════════════════════════════════

  it('unauthenticated: POST /companies/:id/partners → 401', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .send({ code: 'C001', name: 'Công ty Khách Hàng A' });
    expect(res.status).toBe(401);
  });

  it('unauthenticated: GET /companies/:id/partners → 401', async () => {
    const res = await request(app.getHttpServer()).get(`/companies/${smeId}/partners`);
    expect(res.status).toBe(401);
  });

  it('unauthenticated: GET /partners/:id → 401', async () => {
    const res = await request(app.getHttpServer()).get(
      `/partners/00000000-0000-0000-0000-000000000000`,
    );
    expect(res.status).toBe(401);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ADMIN — positive control
  // ═══════════════════════════════════════════════════════════════════════════

  let adminCreatedId: string;

  it('admin: POST /companies/:id/partners → 201 with id', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'C001', name: 'Công ty Khách Hàng A', partnerType: 'customer' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.code).toBe('C001');
    expect(res.body.name).toBe('Công ty Khách Hàng A');
    expect(res.body.partnerType).toBe('customer');
    expect(res.body.companyId).toBe(smeId);
    adminCreatedId = res.body.id as string;
  });

  it('admin: GET /companies/:id/partners → list includes created partner', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = (res.body as Array<{ id: string; code: string }>).find(
      (p) => p.id === adminCreatedId,
    );
    expect(found).toBeDefined();
    expect(found!.code).toBe('C001');
  });

  it('admin: GET /partners/:id → returns the partner', async () => {
    const res = await request(app.getHttpServer())
      .get(`/partners/${adminCreatedId}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(adminCreatedId);
    expect(res.body.code).toBe('C001');
    expect(res.body.companyId).toBe(smeId);
  });

  it('admin: POST duplicate code for same company → 409 Conflict', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'C001', name: 'Duplicate Partner' });
    expect(res.status).toBe(409);
  });

  it('admin: same code for DIFFERENT company → 201 (code unique per company)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'C001', name: 'HKD Khách Hàng A' });
    expect(res.status).toBe(201);
    expect(res.body.companyId).toBe(hkdId);
  });

  it('admin: default partnerType is customer when not supplied', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'V001', name: 'Vendor A' });
    expect(res.status).toBe(201);
    expect(res.body.partnerType).toBe('customer');
  });

  it('admin: GET /partners/:id for unknown id → 404', async () => {
    const res = await request(app.getHttpServer())
      .get(`/partners/00000000-0000-0000-0000-000000000001`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  it('admin: missing code → 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({ name: 'Missing Code' });
    expect(res.status).toBe(400);
  });

  it('admin: missing name → 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'X999' });
    expect(res.status).toBe(400);
  });

  it('admin: invalid partnerType → 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'X998', name: 'Bad Type', partnerType: 'supplier' });
    expect(res.status).toBe(400);
  });

  it('admin: invalid email → 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'X997', name: 'Bad Email', email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCOUNTANT — has access to SME only
  // ═══════════════════════════════════════════════════════════════════════════

  let acctCreatedId: string;

  it('accountant: POST to granted SME → 201', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', acctCookie)
      .send({ code: 'C010', name: 'Acct Created Partner', partnerType: 'customer' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.companyId).toBe(smeId);
    acctCreatedId = res.body.id as string;
  });

  it('accountant: GET /companies/:id/partners for SME → 200 with own partner', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/partners`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = (res.body as Array<{ id: string }>).find((p) => p.id === acctCreatedId);
    expect(found).toBeDefined();
  });

  it('accountant: GET /partners/:id for own partner → 200', async () => {
    const res = await request(app.getHttpServer())
      .get(`/partners/${acctCreatedId}`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(acctCreatedId);
  });

  it('accountant: POST to non-granted Household → 403', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/partners`)
      .set('Cookie', acctCookie)
      .send({ code: 'C099', name: 'Cross-company attempt' });
    expect(res.status).toBe(403);
  });

  it('accountant: GET /companies/:id/partners for Household → 200 empty (RLS scoped, no leak)', async () => {
    // RLS on business_partners filters rows to accessible companies.
    // The accountant sees an empty array — household partners do NOT leak.
    const res = await request(app.getHttpServer())
      .get(`/companies/${hkdId}/partners`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
    // Explicit: household partner code/names must not appear.
    expect(JSON.stringify(res.body)).not.toContain('C001');
    expect(JSON.stringify(res.body)).not.toContain('HKD Khách Hàng A');
  });
});
