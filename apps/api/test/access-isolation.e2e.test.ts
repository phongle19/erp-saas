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

maybe('per-company access isolation (RLS + guard)', () => {
  beforeAll(async () => {
    app = await makeApp();
    ({ adminCookie, acctCookie, smeId, hkdId } = await seedTwoCompaniesAndUsers(app));
  });
  afterAll(async () => {
    await closeApp(app);
  });

  it('admin sees all companies', async () => {
    const res = await request(app.getHttpServer()).get('/companies').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.map((c: { id: string }) => c.id).sort()).toEqual([smeId, hkdId].sort());
  });

  it('accountant granted only the SME sees ONLY the SME', async () => {
    const res = await request(app.getHttpServer()).get('/companies').set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    expect(res.body.map((c: { id: string }) => c.id)).toEqual([smeId]);
  });

  it('accountant cannot read the household company directly (RLS-hidden => 404)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${hkdId}`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(404);
  });

  it('accountant cannot create a company (admin only => 403)', async () => {
    const res = await request(app.getHttpServer())
      .post('/companies')
      .set('Cookie', acctCookie)
      .send({ name: 'X', regime: 'circular_133', functionalCurrency: 'VND' });
    expect(res.status).toBe(403);
  });

  it('unauthenticated request fails closed (401)', async () => {
    const res = await request(app.getHttpServer()).get('/companies');
    expect(res.status).toBe(401);
  });
});
