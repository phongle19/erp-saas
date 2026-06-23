/**
 * Integration tests for the PostingEngine + journal endpoints:
 *   - POST /journal-entries           (post a balanced entry, draft->posted)
 *   - POST /journal-entries/:id/reverse
 *   - GET  /journal-entries/:id
 *
 * Runs against a real Postgres DB as the NOBYPASSRLS `erp` role, so the P4
 * deferred-balance and posted-immutability triggers are in force — this proves
 * the app-layer engine honors the draft->posted sequence and the
 * reversal-sets-only-status rule, and that unbalanced posts persist NOTHING
 * (the request tx rolls back).
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
let smeId: string; // circular_133 company (accountant HAS access)
let hkdId: string; // circular_88 company (accountant LACKS access)

/** Fetch the open period of a given periodNo for the SME's fiscal year. */
async function periodId(fiscalYear: number, periodNo: number): Promise<string> {
  const res = await request(app.getHttpServer())
    .get(`/companies/${smeId}/periods?fiscalYear=${fiscalYear}`)
    .set('Cookie', adminCookie);
  const p = res.body.find((x: { periodNo: number }) => x.periodNo === periodNo);
  if (!p) throw new Error(`period ${periodNo}/${fiscalYear} not found`);
  return p.id as string;
}

maybe('PostingEngine + journal endpoints', () => {
  beforeAll(async () => {
    app = await makeApp();
    ({ adminCookie, acctCookie, smeId, hkdId } = await seedTwoCompaniesAndUsers(app));

    // Provision CoA for the SME (circular_133 -> includes 111/511/...).
    const prov = await request(app.getHttpServer())
      .post(`/companies/${smeId}/coa/provision`)
      .set('Cookie', adminCookie);
    expect(prov.status).toBe(200);
    expect(prov.body.inserted).toBeGreaterThan(0);

    // Provision CoA for the household company too (for the cross-company test).
    const provHkd = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/coa/provision`)
      .set('Cookie', adminCookie);
    expect(provHkd.status).toBe(200);

    // FY2026: 12 regular + a special period 13 (closing).
    const fy = await request(app.getHttpServer())
      .post(`/companies/${smeId}/fiscal-years`)
      .set('Cookie', adminCookie)
      .send({
        fiscalYear: 2026,
        specialPeriods: [{ periodNo: 13, purpose: 'closing', nameVi: 'Khóa sổ' }],
      });
    expect(fy.status).toBe(200);

    // FY2027 too, to prove entry_no resets across fiscal years.
    const fy27 = await request(app.getHttpServer())
      .post(`/companies/${smeId}/fiscal-years`)
      .set('Cookie', adminCookie)
      .send({ fiscalYear: 2027 });
    expect(fy27.status).toBe(200);
  });

  afterAll(async () => {
    await closeApp(app);
  });

  // -------------------------------------------------------------------------
  // Posting balanced entries; entry_no sequencing
  // -------------------------------------------------------------------------

  it('posts a balanced entry → 201, status posted, entryNo 1', async () => {
    const pid = await periodId(2026, 1);
    const res = await request(app.getHttpServer())
      .post('/journal-entries')
      .set('Cookie', adminCookie)
      .send({
        companyId: smeId,
        periodId: pid,
        entryDate: '2026-04-05',
        description: 'Thu tiền mặt',
        lines: [
          { accountCode: '111', debitMinor: '1000000', creditMinor: '0' },
          { accountCode: '511', debitMinor: '0', creditMinor: '1000000' },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('posted');
    expect(res.body.entryNo).toBe(1);
    expect(res.body.postedAt).not.toBeNull();
    expect(res.body.lines).toHaveLength(2);
    expect(res.body.fiscalYear).toBe(2026);
  });

  it('posts a second balanced entry → entryNo 2', async () => {
    const pid = await periodId(2026, 1);
    const res = await request(app.getHttpServer())
      .post('/journal-entries')
      .set('Cookie', adminCookie)
      .send({
        companyId: smeId,
        periodId: pid,
        entryDate: '2026-04-06',
        description: 'Bút toán 2',
        lines: [
          { accountCode: '111', debitMinor: '2000000', creditMinor: '0' },
          { accountCode: '511', debitMinor: '0', creditMinor: '2000000' },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.entryNo).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Unbalanced → 422 AND nothing persisted (tx rolled back, no entry_no gap)
  // -------------------------------------------------------------------------

  it('unbalanced entry → 422 and persists nothing (no entry_no gap)', async () => {
    const pid = await periodId(2026, 1);
    const bad = await request(app.getHttpServer())
      .post('/journal-entries')
      .set('Cookie', adminCookie)
      .send({
        companyId: smeId,
        periodId: pid,
        entryDate: '2026-04-07',
        description: 'KHONG-CAN-BANG-should-not-persist',
        lines: [
          { accountCode: '111', debitMinor: '100', creditMinor: '0' },
          { accountCode: '511', debitMinor: '0', creditMinor: '90' },
        ],
      });
    expect(bad.status).toBe(422);

    // The next successful post must still get entryNo 3 (no gap from a
    // committed-then-failed entry).
    const good = await request(app.getHttpServer())
      .post('/journal-entries')
      .set('Cookie', adminCookie)
      .send({
        companyId: smeId,
        periodId: pid,
        entryDate: '2026-04-08',
        description: 'Bút toán 3',
        lines: [
          { accountCode: '111', debitMinor: '500000', creditMinor: '0' },
          { accountCode: '511', debitMinor: '0', creditMinor: '500000' },
        ],
      });
    expect(good.status).toBe(201);
    expect(good.body.entryNo).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Closed period → 422
  // -------------------------------------------------------------------------

  it('posting into a closed period → 422', async () => {
    const pid = await periodId(2026, 2);
    const close = await request(app.getHttpServer())
      .post(`/periods/${pid}/close`)
      .set('Cookie', adminCookie);
    expect(close.status).toBe(200);

    const res = await request(app.getHttpServer())
      .post('/journal-entries')
      .set('Cookie', adminCookie)
      .send({
        companyId: smeId,
        periodId: pid,
        entryDate: '2026-05-01',
        description: 'Vào kỳ đã đóng',
        lines: [
          { accountCode: '111', debitMinor: '100000', creditMinor: '0' },
          { accountCode: '511', debitMinor: '0', creditMinor: '100000' },
        ],
      });
    expect(res.status).toBe(422);
  });

  // -------------------------------------------------------------------------
  // Special period (13) → 201
  // -------------------------------------------------------------------------

  it('posting into a special period (13) → 201', async () => {
    const pid = await periodId(2026, 13);
    const res = await request(app.getHttpServer())
      .post('/journal-entries')
      .set('Cookie', adminCookie)
      .send({
        companyId: smeId,
        periodId: pid,
        entryDate: '2026-12-31',
        description: 'Điều chỉnh khóa sổ',
        lines: [
          { accountCode: '111', debitMinor: '300000', creditMinor: '0' },
          { accountCode: '511', debitMinor: '0', creditMinor: '300000' },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('posted');
  });

  // -------------------------------------------------------------------------
  // Unknown account code → 422
  // -------------------------------------------------------------------------

  it('unknown account code → 422', async () => {
    const pid = await periodId(2026, 1);
    const res = await request(app.getHttpServer())
      .post('/journal-entries')
      .set('Cookie', adminCookie)
      .send({
        companyId: smeId,
        periodId: pid,
        entryDate: '2026-04-09',
        description: 'Tài khoản lạ',
        lines: [
          { accountCode: '999999', debitMinor: '100', creditMinor: '0' },
          { accountCode: '511', debitMinor: '0', creditMinor: '100' },
        ],
      });
    expect(res.status).toBe(422);
  });

  // -------------------------------------------------------------------------
  // Account resolution is scoped to input.companyId. The household (circular_88)
  // CoA is a strict subset of the SME's (circular_133); a code that exists in
  // the SME's CoA but NOT the household's, when posted under the household, must
  // be "unknown account for this company" → 422. This proves codes never leak
  // across companies even when another company has them.
  // -------------------------------------------------------------------------

  it('account code valid for another company is unknown here → 422', async () => {
    const smeAccts = await request(app.getHttpServer())
      .get(`/companies/${smeId}/accounts`)
      .set('Cookie', adminCookie);
    const hkdAccts = await request(app.getHttpServer())
      .get(`/companies/${hkdId}/accounts`)
      .set('Cookie', adminCookie);
    const hkdCodes = new Set(hkdAccts.body.map((a: { code: string }) => a.code));
    // A code present for the SME but absent from the household's CoA.
    const smeOnly = smeAccts.body
      .map((a: { code: string }) => a.code)
      .find((c: string) => !hkdCodes.has(c));
    expect(smeOnly).toBeTruthy();
    // And a code valid for the household, to keep the entry otherwise balanced.
    const hkdAny: string = [...hkdCodes][0] as string;

    // Generate a fiscal year + period for the household so the period check passes.
    await request(app.getHttpServer())
      .post(`/companies/${hkdId}/fiscal-years`)
      .set('Cookie', adminCookie)
      .send({ fiscalYear: 2026 });
    const periodsRes = await request(app.getHttpServer())
      .get(`/companies/${hkdId}/periods?fiscalYear=2026`)
      .set('Cookie', adminCookie);
    const hkdPid = periodsRes.body.find(
      (p: { periodNo: number }) => p.periodNo === 1,
    ).id as string;

    const res = await request(app.getHttpServer())
      .post('/journal-entries')
      .set('Cookie', adminCookie)
      .send({
        companyId: hkdId,
        periodId: hkdPid,
        entryDate: '2026-01-10',
        description: 'Mã TK của công ty khác',
        lines: [
          { accountCode: smeOnly, debitMinor: '100', creditMinor: '0' },
          { accountCode: hkdAny, debitMinor: '0', creditMinor: '100' },
        ],
      });
    expect(res.status).toBe(422);
  });

  // -------------------------------------------------------------------------
  // Non-admin posting to a company they lack access to → 403
  // -------------------------------------------------------------------------

  it('accountant posting to a company they lack access to → 403', async () => {
    // The accountant only has access to smeId, not hkdId.
    // Use any period under hkd; we don't need it to exist because the access
    // check runs first. Use the SME period id (the engine checks companyId).
    const pid = await periodId(2026, 1);
    const res = await request(app.getHttpServer())
      .post('/journal-entries')
      .set('Cookie', acctCookie)
      .send({
        companyId: hkdId,
        periodId: pid,
        entryDate: '2026-04-11',
        description: 'Không có quyền',
        lines: [
          { accountCode: '111', debitMinor: '100', creditMinor: '0' },
          { accountCode: '511', debitMinor: '0', creditMinor: '100' },
        ],
      });
    expect(res.status).toBe(403);
  });

  it('accountant CAN post to the company they have access to → 201', async () => {
    const pid = await periodId(2026, 1);
    const res = await request(app.getHttpServer())
      .post('/journal-entries')
      .set('Cookie', acctCookie)
      .send({
        companyId: smeId,
        periodId: pid,
        entryDate: '2026-04-12',
        description: 'Kế toán có quyền',
        lines: [
          { accountCode: '111', debitMinor: '700000', creditMinor: '0' },
          { accountCode: '511', debitMinor: '0', creditMinor: '700000' },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('posted');
  });

  // -------------------------------------------------------------------------
  // Reversal
  // -------------------------------------------------------------------------

  it('reverses a posted entry → 201, lines swapped, original marked reversed', async () => {
    const pid = await periodId(2026, 1);
    // Post a fresh entry to reverse.
    const orig = await request(app.getHttpServer())
      .post('/journal-entries')
      .set('Cookie', adminCookie)
      .send({
        companyId: smeId,
        periodId: pid,
        entryDate: '2026-04-15',
        description: 'Cần đảo',
        lines: [
          { accountCode: '111', debitMinor: '1500000', creditMinor: '0' },
          { accountCode: '511', debitMinor: '0', creditMinor: '1500000' },
        ],
      });
    expect(orig.status).toBe(201);
    const origId = orig.body.id as string;
    const origEntryNo = orig.body.entryNo as number;

    const rev = await request(app.getHttpServer())
      .post(`/journal-entries/${origId}/reverse`)
      .set('Cookie', adminCookie)
      .send({});
    expect(rev.status).toBe(201);
    expect(rev.body.status).toBe('posted');
    expect(rev.body.reversesEntryId).toBe(origId);
    expect(rev.body.description).toBe(`Đảo bút toán #${origEntryNo}`);

    // Lines are the swap: the original's debit-111 becomes credit-111, etc.
    const origLine111 = orig.body.lines.find(
      (l: { accountId: string; debitMinor: string }) =>
        l.debitMinor === '1500000',
    );
    const revLine = rev.body.lines.find(
      (l: { accountId: string }) => l.accountId === origLine111.accountId,
    );
    expect(revLine.debitMinor).toBe('0');
    expect(revLine.creditMinor).toBe('1500000');

    // GET the original → status 'reversed'.
    const getOrig = await request(app.getHttpServer())
      .get(`/journal-entries/${origId}`)
      .set('Cookie', adminCookie);
    expect(getOrig.status).toBe(200);
    expect(getOrig.body.status).toBe('reversed');
    // Reversing didn't mutate the original's description/postedAt.
    expect(getOrig.body.description).toBe('Cần đảo');
  });

  it('reversing a non-posted (already reversed) entry → 422', async () => {
    const pid = await periodId(2026, 1);
    const orig = await request(app.getHttpServer())
      .post('/journal-entries')
      .set('Cookie', adminCookie)
      .send({
        companyId: smeId,
        periodId: pid,
        entryDate: '2026-04-16',
        description: 'Đảo một lần',
        lines: [
          { accountCode: '111', debitMinor: '100000', creditMinor: '0' },
          { accountCode: '511', debitMinor: '0', creditMinor: '100000' },
        ],
      });
    const origId = orig.body.id as string;

    const rev1 = await request(app.getHttpServer())
      .post(`/journal-entries/${origId}/reverse`)
      .set('Cookie', adminCookie);
    expect(rev1.status).toBe(201);

    const rev2 = await request(app.getHttpServer())
      .post(`/journal-entries/${origId}/reverse`)
      .set('Cookie', adminCookie);
    expect(rev2.status).toBe(422);
  });

  it('GET unknown entry → 404', async () => {
    const res = await request(app.getHttpServer())
      .get('/journal-entries/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });

  // -------------------------------------------------------------------------
  // entry_no resets across fiscal years
  // -------------------------------------------------------------------------

  it('entry_no resets across fiscal years (FY2027 first post → entryNo 1)', async () => {
    const pid = await periodId(2027, 1);
    const res = await request(app.getHttpServer())
      .post('/journal-entries')
      .set('Cookie', adminCookie)
      .send({
        companyId: smeId,
        periodId: pid,
        entryDate: '2027-01-05',
        description: 'Năm tài chính mới',
        lines: [
          { accountCode: '111', debitMinor: '100000', creditMinor: '0' },
          { accountCode: '511', debitMinor: '0', creditMinor: '100000' },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.entryNo).toBe(1);
    expect(res.body.fiscalYear).toBe(2027);
  });
});
