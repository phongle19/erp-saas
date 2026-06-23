/**
 * Integration tests for the partnerId dimension in the PostingEngine:
 *   - A line carrying partnerId persists it in journal_lines.
 *   - Reversing that entry carries the SAME partnerId onto the reversal lines.
 *   - A line WITHOUT partnerId still persists null (unchanged behaviour).
 *
 * DB-backed, runs as the NOBYPASSRLS `erp` role (same setup as posting.int.test.ts).
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
let partnerId: string;

/** Fetch the open period periodNo for the SME's fiscal year 2026. */
async function periodId(periodNo: number): Promise<string> {
  const res = await request(app.getHttpServer())
    .get(`/companies/${smeId}/periods?fiscalYear=2026`)
    .set('Cookie', adminCookie);
  const p = res.body.find((x: { periodNo: number }) => x.periodNo === periodNo);
  if (!p) throw new Error(`period ${periodNo}/2026 not found`);
  return p.id as string;
}

maybe('PostingEngine — partnerId dimension', () => {
  beforeAll(async () => {
    app = await makeApp();
    ({ adminCookie, smeId } = await seedTwoCompaniesAndUsers(app));

    // Provision CoA for the SME.
    const prov = await request(app.getHttpServer())
      .post(`/companies/${smeId}/coa/provision`)
      .set('Cookie', adminCookie);
    expect(prov.status).toBe(200);

    // Create FY2026 periods.
    const fy = await request(app.getHttpServer())
      .post(`/companies/${smeId}/fiscal-years`)
      .set('Cookie', adminCookie)
      .send({ fiscalYear: 2026 });
    expect(fy.status).toBe(200);

    // Insert a business partner inside a postgres.js transaction with admin-context
    // GUCs so the RLS WITH CHECK passes.  rawSql is the app's connection pool
    // (erp NOBYPASSRLS role); we set the session-local GUCs inside the tx to
    // satisfy `app_is_admin()`.  We don't need the A4 customer endpoint to exist yet.
    const result = await app.rawSql.begin(async (tx) => {
      await tx.unsafe(
        `SELECT set_config('app.user_id',              '00000000-0000-0000-0000-000000000001', true)`,
      );
      await tx.unsafe(
        `SELECT set_config('app.is_admin',             'true',                                 true)`,
      );
      await tx.unsafe(
        `SELECT set_config('app.accessible_companies', '${smeId}',                             true)`,
      );
      const rows: Array<{ id: string }> = await tx.unsafe(
        `INSERT INTO business_partners (company_id, code, name, partner_type)
         VALUES ('${smeId}', 'C001', 'Test Customer', 'customer')
         RETURNING id`,
      );
      return rows[0]!.id;
    });
    partnerId = result;
  });

  afterAll(async () => {
    await closeApp(app);
  });

  // ---------------------------------------------------------------------------
  // partnerId persists on the line
  // ---------------------------------------------------------------------------

  it('line with partnerId → journal_lines row carries that partnerId', async () => {
    const pid = await periodId(1);
    const res = await request(app.getHttpServer())
      .post('/journal-entries')
      .set('Cookie', adminCookie)
      .send({
        companyId: smeId,
        periodId: pid,
        entryDate: '2026-04-01',
        description: 'Test partner dimension',
        lines: [
          {
            accountCode: '131', // AR
            debitMinor: '5000000',
            creditMinor: '0',
            partnerId,
          },
          {
            accountCode: '511',
            debitMinor: '0',
            creditMinor: '5000000',
            // no partnerId on the revenue line
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('posted');

    // Use the GET endpoint to read back the lines (RLS-scoped via the admin session).
    // The serializer spreads all line columns including partnerId.
    const getRes = await request(app.getHttpServer())
      .get(`/journal-entries/${res.body.id as string}`)
      .set('Cookie', adminCookie);
    expect(getRes.status).toBe(200);
    const lines: Array<{ debitMinor: string; creditMinor: string; partnerId: string | null }> =
      getRes.body.lines;

    const arLine = lines.find((l) => l.debitMinor === '5000000');
    const revLine = lines.find((l) => l.creditMinor === '5000000');

    expect(arLine?.partnerId).toBe(partnerId);
    expect(revLine?.partnerId).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // reversal carries the same partnerId
  // ---------------------------------------------------------------------------

  it('reversing an entry → reversal lines carry the same partnerId', async () => {
    const pid = await periodId(1);

    // Post an entry with a partner-tagged AR line.
    const orig = await request(app.getHttpServer())
      .post('/journal-entries')
      .set('Cookie', adminCookie)
      .send({
        companyId: smeId,
        periodId: pid,
        entryDate: '2026-04-02',
        description: 'Cần đảo — có partner',
        lines: [
          {
            accountCode: '131',
            debitMinor: '3000000',
            creditMinor: '0',
            partnerId,
          },
          {
            accountCode: '511',
            debitMinor: '0',
            creditMinor: '3000000',
          },
        ],
      });
    expect(orig.status).toBe(201);
    const origId = orig.body.id as string;

    // Reverse it.
    const rev = await request(app.getHttpServer())
      .post(`/journal-entries/${origId}/reverse`)
      .set('Cookie', adminCookie)
      .send({});
    expect(rev.status).toBe(201);
    expect(rev.body.status).toBe('posted');

    // Read back the reversal lines via GET (RLS-scoped, admin session).
    // In the reversal the AR account has debit=0, credit=3000000 (debit/credit swapped).
    const revGet = await request(app.getHttpServer())
      .get(`/journal-entries/${rev.body.id as string}`)
      .set('Cookie', adminCookie);
    expect(revGet.status).toBe(200);
    const revLines: Array<{ debitMinor: string; creditMinor: string; partnerId: string | null }> =
      revGet.body.lines;

    const revArLine = revLines.find((l) => l.creditMinor === '3000000');
    const revRevLine = revLines.find((l) => l.debitMinor === '3000000');

    expect(revArLine?.partnerId).toBe(partnerId);
    expect(revRevLine?.partnerId).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // line without partnerId persists null (unchanged behaviour)
  // ---------------------------------------------------------------------------

  it('line without partnerId → journal_lines.partner_id is null', async () => {
    const pid = await periodId(1);
    const res = await request(app.getHttpServer())
      .post('/journal-entries')
      .set('Cookie', adminCookie)
      .send({
        companyId: smeId,
        periodId: pid,
        entryDate: '2026-04-03',
        description: 'Không có partner',
        lines: [
          { accountCode: '111', debitMinor: '1000000', creditMinor: '0' },
          { accountCode: '511', debitMinor: '0', creditMinor: '1000000' },
        ],
      });

    expect(res.status).toBe(201);

    // GET back the entry and confirm all lines have partnerId null.
    const getRes = await request(app.getHttpServer())
      .get(`/journal-entries/${res.body.id as string}`)
      .set('Cookie', adminCookie);
    expect(getRes.status).toBe(200);
    const lines: Array<{ partnerId: string | null }> = getRes.body.lines;

    for (const l of lines) {
      expect(l.partnerId).toBeNull();
    }
  });
});
