/**
 * Integration tests — material (inventory item) master (B4).
 *
 * Covers:
 *   - admin creates a material for the SME → 201 with id; defaults applied (unit 'cái', acct '156')
 *   - list returns the created material
 *   - get by id returns it
 *   - duplicate code same company → 409 Conflict
 *   - same code different company → 201
 *   - accountant (granted SME) creates/lists SME materials → 201/200
 *   - accountant creates for Household (not granted) → 403
 *   - accountant lists Household materials → 200 empty (RLS scoped, no leak)
 *   - unauthenticated → 401
 *   - Zod 400 on missing code/name
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

maybe('materials master (B4)', () => {
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

  it('unauthenticated: POST /companies/:id/materials → 401', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/materials`)
      .send({ code: 'M001', name: 'Hàng hoá A' });
    expect(res.status).toBe(401);
  });

  it('unauthenticated: GET /companies/:id/materials → 401', async () => {
    const res = await request(app.getHttpServer()).get(`/companies/${smeId}/materials`);
    expect(res.status).toBe(401);
  });

  it('unauthenticated: GET /materials/:id → 401', async () => {
    const res = await request(app.getHttpServer()).get(
      `/materials/00000000-0000-0000-0000-000000000000`,
    );
    expect(res.status).toBe(401);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ADMIN — positive control
  // ═══════════════════════════════════════════════════════════════════════════

  let adminCreatedId: string;

  it('admin: POST /companies/:id/materials → 201 with id', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/materials`)
      .set('Cookie', adminCookie)
      .send({ code: 'M001', name: 'Hàng hoá A' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.code).toBe('M001');
    expect(res.body.name).toBe('Hàng hoá A');
    expect(res.body.companyId).toBe(smeId);
    adminCreatedId = res.body.id as string;
  });

  it('admin: defaults applied — unit = "cái", inventoryAccountCode = "156"', async () => {
    const res = await request(app.getHttpServer())
      .get(`/materials/${adminCreatedId}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.unit).toBe('cái');
    expect(res.body.inventoryAccountCode).toBe('156');
    expect(res.body.isActive).toBe(true);
  });

  it('admin: GET /companies/:id/materials → list includes created material', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/materials`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = (res.body as Array<{ id: string; code: string }>).find(
      (m) => m.id === adminCreatedId,
    );
    expect(found).toBeDefined();
    expect(found!.code).toBe('M001');
  });

  it('admin: GET /materials/:id → returns the material', async () => {
    const res = await request(app.getHttpServer())
      .get(`/materials/${adminCreatedId}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(adminCreatedId);
    expect(res.body.code).toBe('M001');
    expect(res.body.companyId).toBe(smeId);
  });

  it('admin: POST duplicate code same company → 409 Conflict', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/materials`)
      .set('Cookie', adminCookie)
      .send({ code: 'M001', name: 'Duplicate Material' });
    expect(res.status).toBe(409);
  });

  it('admin: same code DIFFERENT company → 201 (code unique per company)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/materials`)
      .set('Cookie', adminCookie)
      .send({ code: 'M001', name: 'HKD Hàng hoá A' });
    expect(res.status).toBe(201);
    expect(res.body.companyId).toBe(hkdId);
  });

  it('admin: explicit unit and inventoryAccountCode are stored', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/materials`)
      .set('Cookie', adminCookie)
      .send({ code: 'M002', name: 'Nguyên liệu thô', unit: 'kg', inventoryAccountCode: '152' });
    expect(res.status).toBe(201);
    expect(res.body.unit).toBe('kg');
    expect(res.body.inventoryAccountCode).toBe('152');
  });

  it('admin: GET /materials/:id for unknown id → 404', async () => {
    const res = await request(app.getHttpServer())
      .get(`/materials/00000000-0000-0000-0000-000000000001`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  it('admin: missing code → 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/materials`)
      .set('Cookie', adminCookie)
      .send({ name: 'Missing Code' });
    expect(res.status).toBe(400);
  });

  it('admin: missing name → 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/materials`)
      .set('Cookie', adminCookie)
      .send({ code: 'X999' });
    expect(res.status).toBe(400);
  });

  it('admin: empty-string code → 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/materials`)
      .set('Cookie', adminCookie)
      .send({ code: '', name: 'Empty code' });
    expect(res.status).toBe(400);
  });

  it('admin: empty-string inventoryAccountCode → 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/materials`)
      .set('Cookie', adminCookie)
      .send({ code: 'X998', name: 'Bad acct', inventoryAccountCode: '' });
    expect(res.status).toBe(400);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCOUNTANT — has access to SME only
  // ═══════════════════════════════════════════════════════════════════════════

  let acctCreatedId: string;

  it('accountant: POST to granted SME → 201', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/materials`)
      .set('Cookie', acctCookie)
      .send({ code: 'M010', name: 'Acct Created Material' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.companyId).toBe(smeId);
    acctCreatedId = res.body.id as string;
  });

  it('accountant: GET /companies/:id/materials for SME → 200 with own material', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/materials`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = (res.body as Array<{ id: string }>).find((m) => m.id === acctCreatedId);
    expect(found).toBeDefined();
  });

  it('accountant: GET /materials/:id for own material → 200', async () => {
    const res = await request(app.getHttpServer())
      .get(`/materials/${acctCreatedId}`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(acctCreatedId);
  });

  it('accountant: POST to non-granted Household → 403', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/materials`)
      .set('Cookie', acctCookie)
      .send({ code: 'M099', name: 'Cross-company attempt' });
    expect(res.status).toBe(403);
  });

  it('accountant: GET /companies/:id/materials for Household → 200 empty (RLS scoped, no leak)', async () => {
    // RLS on materials filters rows to accessible companies.
    // The accountant sees an empty array — household materials do NOT leak.
    const res = await request(app.getHttpServer())
      .get(`/companies/${hkdId}/materials`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
    // Explicit: household material code/names must not appear.
    expect(JSON.stringify(res.body)).not.toContain('M001');
    expect(JSON.stringify(res.body)).not.toContain('HKD Hàng hoá A');
  });
});
