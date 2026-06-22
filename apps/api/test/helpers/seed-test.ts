import request from 'supertest';
import { eq } from 'drizzle-orm';
import { schema } from '@erp/db';
import type { TestApp } from './make-app.js';

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'S3cure!passw0rd';
const ACCT_EMAIL = 'accountant@example.com';
const ACCT_PASSWORD = 'S3cure!passw0rd';

export interface SeedResult {
  adminCookie: string;
  acctCookie: string;
  adminUserId: string;
  acctUserId: string;
  smeId: string;
  hkdId: string;
}

/** Extract the `sid=...` Set-Cookie string usable as a request Cookie header. */
function extractSidCookie(res: request.Response): string {
  const header = res.headers['set-cookie'] as string[] | string | undefined;
  const cookies = Array.isArray(header) ? header : header ? [header] : [];
  const sid = cookies.find((c) => c.startsWith('sid='));
  if (!sid) throw new Error('no sid cookie set on login response');
  return sid.split(';')[0]!; // "sid=<token>"
}

/**
 * Seed the access-isolation scenario entirely through the API:
 *  - bootstrap + login the admin
 *  - create an SME (circular_133) and a household (circular_88) company
 *  - create a non-admin accountant user
 *  - grant the accountant access to ONLY the SME
 *  - login as the accountant
 * Returns both session cookies and the relevant ids.
 *
 * Assumes a freshly-truncated database (so bootstrap succeeds).
 */
export async function seedTwoCompaniesAndUsers(
  app: TestApp,
): Promise<SeedResult> {
  const http = () => request(app.getHttpServer());

  const bootstrap = await http().post('/auth/bootstrap').send({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    displayName: 'Admin',
    ownerName: 'Demo Owner Co',
  });
  if (bootstrap.status !== 201) {
    throw new Error(`bootstrap failed: ${bootstrap.status} ${JSON.stringify(bootstrap.body)}`);
  }

  const adminLogin = await http()
    .post('/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (adminLogin.status !== 200) {
    throw new Error(`admin login failed: ${adminLogin.status}`);
  }
  const adminCookie = extractSidCookie(adminLogin);

  const sme = await http()
    .post('/companies')
    .set('Cookie', adminCookie)
    .send({ name: 'SME Co', regime: 'circular_133', functionalCurrency: 'VND' });
  if (sme.status !== 201) {
    throw new Error(`create SME failed: ${sme.status} ${JSON.stringify(sme.body)}`);
  }
  const smeId = sme.body.id as string;

  const hkd = await http()
    .post('/companies')
    .set('Cookie', adminCookie)
    .send({
      name: 'Household Biz',
      regime: 'circular_88',
      functionalCurrency: 'VND',
      householdTier: '200m_1b',
    });
  if (hkd.status !== 201) {
    throw new Error(`create household failed: ${hkd.status} ${JSON.stringify(hkd.body)}`);
  }
  const hkdId = hkd.body.id as string;

  const acct = await http()
    .post('/users')
    .set('Cookie', adminCookie)
    .send({ email: ACCT_EMAIL, password: ACCT_PASSWORD, displayName: 'Accountant' });
  if (acct.status !== 201) {
    throw new Error(`create accountant failed: ${acct.status} ${JSON.stringify(acct.body)}`);
  }
  const acctUserId = acct.body.id as string;

  const grant = await http()
    .post('/company-access')
    .set('Cookie', adminCookie)
    .send({ userId: acctUserId, companyId: smeId, role: 'accountant' });
  if (grant.status !== 201) {
    throw new Error(`grant failed: ${grant.status} ${JSON.stringify(grant.body)}`);
  }

  const acctLogin = await http()
    .post('/auth/login')
    .send({ email: ACCT_EMAIL, password: ACCT_PASSWORD });
  if (acctLogin.status !== 200) {
    throw new Error(`accountant login failed: ${acctLogin.status}`);
  }
  const acctCookie = extractSidCookie(acctLogin);

  // Resolve the admin's user id (needed for audit assertions). `users` has no RLS.
  const adminRows = await app.db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, ADMIN_EMAIL))
    .limit(1);
  const adminUserId = adminRows[0]!.id;

  return {
    adminCookie,
    acctCookie,
    adminUserId,
    acctUserId,
    smeId,
    hkdId,
  };
}
