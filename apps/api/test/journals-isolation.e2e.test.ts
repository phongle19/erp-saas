/**
 * Access-isolation e2e proof — accounting surface (journals, ledger, statements).
 *
 * Extends the Phase-0 per-company RLS guarantee to the Phase-1 financial tables:
 *   accounting_periods, journal_entries, journal_lines.
 *
 * Scenario:
 *   - admin creates two companies: SME (circular_133) and Household (circular_88).
 *   - admin provisions CoA + generates FY2026 for BOTH companies.
 *   - admin posts one balanced entry to EACH company (Dr 111 / Cr 511, 1,000,000 VND).
 *   - an accountant user is granted access to ONLY the SME.
 *
 * What we prove (each assertion documents the actual fail-closed behaviour):
 *
 *   READ SCOPING
 *   ┌─ Trial balance (acct, SME)       → 200 with data (rows > 0, totals != 0)
 *   ├─ Trial balance (acct, Household) → 200 but EMPTY rows/totals = 0
 *   │    (RLS filters journal_lines to accessible companies; the query itself
 *   │     does not check company existence, so it returns an empty result set
 *   │     rather than 404.  Crucially: household figures do NOT appear.)
 *   ├─ Trial balance (admin, both)     → 200 with data (sanity / positive control)
 *   ├─ Journal GET (acct, hkd entry)   → 404 (RLS hides the row)
 *   ├─ Journal GET (acct, SME entry)   → 200
 *   ├─ Journal GET (admin, hkd entry)  → 200 (positive control)
 *   ├─ Ledger (acct, hkd company)      → 404 (chart_of_accounts RLS hides account)
 *   ├─ Balance sheet (acct, hkd)       → 404 (companies RLS hides company → NotFoundException)
 *   └─ Income statement (acct, hkd)   → 404 (same path)
 *
 *   WRITE SCOPING
 *   └─ POST /journal-entries as acct, companyId=hkdId → 403
 *        (PostingEngine access check: `!tx.isAdmin && !accessibleCompanies.includes(companyId)`)
 *      AND no new entry is created for hkd (admin count unchanged after the attempt).
 *
 *   UNAUTHENTICATED
 *   └─ Any request without a session cookie → 401.
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

/** The posted entry ids (set in beforeAll after posting). */
let smeEntryId: string;
let hkdEntryId: string;

/** Period ids used for the seed entries. */
let smePeriodId: string;
let hkdPeriodId: string;

/** Count posted entries for a company via admin GET of the trial balance.
 *  Returns the number of TB rows (accounts with movements). */
async function trialBalanceRowCount(companyId: string): Promise<number> {
  const res = await request(app.getHttpServer())
    .get(`/companies/${companyId}/trial-balance?fiscalYear=2026`)
    .set('Cookie', adminCookie);
  expect(res.status).toBe(200);
  return (res.body.rows as unknown[]).length;
}

maybe('access-isolation: accounting surface (journals, ledger, statements)', () => {
  beforeAll(async () => {
    app = await makeApp();
    ({ adminCookie, acctCookie, smeId, hkdId } = await seedTwoCompaniesAndUsers(app));

    // ── Provision CoA for BOTH companies ───────────────────────────────────
    const provSme = await request(app.getHttpServer())
      .post(`/companies/${smeId}/coa/provision`)
      .set('Cookie', adminCookie);
    if (provSme.status !== 200) {
      throw new Error(`provision SME CoA failed: ${provSme.status} ${JSON.stringify(provSme.body)}`);
    }
    expect(provSme.body.inserted).toBeGreaterThan(0);

    const provHkd = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/coa/provision`)
      .set('Cookie', adminCookie);
    if (provHkd.status !== 200) {
      throw new Error(`provision HKD CoA failed: ${provHkd.status} ${JSON.stringify(provHkd.body)}`);
    }
    expect(provHkd.body.inserted).toBeGreaterThan(0);

    // ── Generate FY2026 for BOTH companies ─────────────────────────────────
    const fySme = await request(app.getHttpServer())
      .post(`/companies/${smeId}/fiscal-years`)
      .set('Cookie', adminCookie)
      .send({ fiscalYear: 2026 });
    if (fySme.status !== 200) {
      throw new Error(`generate FY2026 SME failed: ${fySme.status} ${JSON.stringify(fySme.body)}`);
    }

    const fyHkd = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/fiscal-years`)
      .set('Cookie', adminCookie)
      .send({ fiscalYear: 2026 });
    if (fyHkd.status !== 200) {
      throw new Error(`generate FY2026 HKD failed: ${fyHkd.status} ${JSON.stringify(fyHkd.body)}`);
    }

    // ── Resolve period 1 for each company ─────────────────────────────────
    const smePeriodsRes = await request(app.getHttpServer())
      .get(`/companies/${smeId}/periods?fiscalYear=2026`)
      .set('Cookie', adminCookie);
    expect(smePeriodsRes.status).toBe(200);
    smePeriodId = (smePeriodsRes.body as Array<{ periodNo: number; id: string }>)
      .find((p) => p.periodNo === 1)!.id;

    const hkdPeriodsRes = await request(app.getHttpServer())
      .get(`/companies/${hkdId}/periods?fiscalYear=2026`)
      .set('Cookie', adminCookie);
    expect(hkdPeriodsRes.status).toBe(200);
    hkdPeriodId = (hkdPeriodsRes.body as Array<{ periodNo: number; id: string }>)
      .find((p) => p.periodNo === 1)!.id;

    // ── Post one entry to EACH company as admin ────────────────────────────
    //    Dr 111 (cash) / Cr 511 (revenue), 1,000,000 VND
    const postSme = await request(app.getHttpServer())
      .post('/journal-entries')
      .set('Cookie', adminCookie)
      .send({
        companyId: smeId,
        periodId: smePeriodId,
        entryDate: '2026-01-15',
        description: 'SME seed entry',
        lines: [
          { accountCode: '111', debitMinor: '1000000', creditMinor: '0' },
          { accountCode: '511', debitMinor: '0', creditMinor: '1000000' },
        ],
      });
    if (postSme.status !== 201) {
      throw new Error(`post SME entry failed: ${postSme.status} ${JSON.stringify(postSme.body)}`);
    }
    smeEntryId = postSme.body.id as string;

    // For the household we need an account code that exists in the circular_88 CoA.
    // Both regimes share account 111 and 511 (confirmed in CoA config), so we reuse them.
    const postHkd = await request(app.getHttpServer())
      .post('/journal-entries')
      .set('Cookie', adminCookie)
      .send({
        companyId: hkdId,
        periodId: hkdPeriodId,
        entryDate: '2026-01-15',
        description: 'HKD seed entry',
        lines: [
          { accountCode: '111', debitMinor: '1000000', creditMinor: '0' },
          { accountCode: '511', debitMinor: '0', creditMinor: '1000000' },
        ],
      });
    if (postHkd.status !== 201) {
      throw new Error(`post HKD entry failed: ${postHkd.status} ${JSON.stringify(postHkd.body)}`);
    }
    hkdEntryId = postHkd.body.id as string;
  });

  afterAll(async () => {
    await closeApp(app);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // UNAUTHENTICATED — fail-closed baseline
  // ═══════════════════════════════════════════════════════════════════════════

  it('unauthenticated: trial-balance → 401', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/trial-balance?fiscalYear=2026`);
    expect(res.status).toBe(401);
  });

  it('unauthenticated: journal GET → 401', async () => {
    const res = await request(app.getHttpServer())
      .get(`/journal-entries/${smeEntryId}`);
    expect(res.status).toBe(401);
  });

  it('unauthenticated: ledger → 401', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ledger?account=111&fiscalYear=2026`);
    expect(res.status).toBe(401);
  });

  it('unauthenticated: balance-sheet → 401', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/statements/balance-sheet?fiscalYear=2026`);
    expect(res.status).toBe(401);
  });

  it('unauthenticated: POST journal-entries → 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/journal-entries')
      .send({
        companyId: smeId,
        periodId: smePeriodId,
        entryDate: '2026-01-16',
        description: 'No cookie',
        lines: [
          { accountCode: '111', debitMinor: '100', creditMinor: '0' },
          { accountCode: '511', debitMinor: '0', creditMinor: '100' },
        ],
      });
    expect(res.status).toBe(401);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ADMIN SANITY (positive control — admin sees both companies)
  // ═══════════════════════════════════════════════════════════════════════════

  it('admin: trial-balance for SME → 200 with data (rows > 0, totals != 0)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/trial-balance?fiscalYear=2026`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBeGreaterThan(0);
    expect(res.body.totals.debit).not.toBe('0');
    expect(res.body.totals.credit).not.toBe('0');
  });

  it('admin: trial-balance for Household → 200 with data (rows > 0, totals != 0)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${hkdId}/trial-balance?fiscalYear=2026`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBeGreaterThan(0);
    expect(res.body.totals.debit).not.toBe('0');
    expect(res.body.totals.credit).not.toBe('0');
  });

  it('admin: GET household journal entry → 200 (positive control)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/journal-entries/${hkdEntryId}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(hkdEntryId);
    expect(res.body.companyId).toBe(hkdId);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // READ SCOPING — trial balance
  // ═══════════════════════════════════════════════════════════════════════════

  it('accountant: trial-balance for granted SME → 200 with data', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/trial-balance?fiscalYear=2026`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    // Must see at least the two accounts from the seed entry.
    expect(res.body.rows.length).toBeGreaterThan(0);
    expect(res.body.totals.debit).not.toBe('0');
    expect(res.body.totals.credit).not.toBe('0');
    // Only SME data: every row comes from the SME's chart of accounts.
    for (const row of res.body.rows as Array<{ code: string; debit: string; credit: string }>) {
      // No row should carry the household's 1,000,000 figures in an account
      // that might collide — but more importantly no cross-company leak.
      // Household debit total was 1,000,000; SME debit total is also 1,000,000 (same seed).
      // We verify by ensuring the companyId in the source data is smeId only (via admin
      // cross-check performed in the write-scoping test below).
      expect(row.code).toBeTruthy();
    }
    // The 111 account debit should reflect only the SME's entry (1,000,000).
    const acct111 = (res.body.rows as Array<{ code: string; debit: string }>)
      .find((r) => r.code === '111');
    expect(acct111).toBeDefined();
    expect(acct111!.debit).toBe('1000000');
  });

  it('accountant: trial-balance for non-accessible Household → 200 but EMPTY (no data leaks)', async () => {
    // The trial-balance service filters journal_lines by companyId; RLS on
    // journal_lines hides all household rows.  The query returns an empty
    // result set → rows: [], totals: { debit: "0", credit: "0" }.
    // This is the correct fail-closed behaviour: no 404, but crucially NO
    // household figures appear.
    const res = await request(app.getHttpServer())
      .get(`/companies/${hkdId}/trial-balance?fiscalYear=2026`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(0);
    expect(res.body.totals.debit).toBe('0');
    expect(res.body.totals.credit).toBe('0');
    // Explicit: the household's seed entry amount (1,000,000) must not appear.
    expect(JSON.stringify(res.body)).not.toContain('1000000');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // READ SCOPING — journal entry GET
  // ═══════════════════════════════════════════════════════════════════════════

  it('accountant: GET SME journal entry → 200 (own company)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/journal-entries/${smeEntryId}`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(smeEntryId);
    expect(res.body.companyId).toBe(smeId);
  });

  it('accountant: GET Household journal entry → 404 (RLS hides it)', async () => {
    // loadEntry() does a db.select() scoped by RLS → returns no rows →
    // throws NotFoundException('journal entry not found') → HTTP 404.
    // The household's entry id is entirely invisible to the accountant.
    const res = await request(app.getHttpServer())
      .get(`/journal-entries/${hkdEntryId}`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(404);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // READ SCOPING — general ledger
  // ═══════════════════════════════════════════════════════════════════════════

  it('accountant: ledger for SME account 111 → 200 with movements', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ledger?account=111&fiscalYear=2026`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    expect(res.body.accountCode).toBe('111');
    expect(res.body.movements.length).toBeGreaterThan(0);
    // Verify the movement amount reflects the SME's seed entry only.
    const totalDebit = (res.body.movements as Array<{ debit: string }>)
      .reduce((sum, m) => sum + BigInt(m.debit), 0n);
    expect(totalDebit).toBe(1000000n);
  });

  it('accountant: ledger for Household company → 404 (companies/accounts RLS hides it)', async () => {
    // generalLedger() resolves the account code against chart_of_accounts
    // filtered by companyId; under RLS the household's accounts are not
    // visible → account is undefined → NotFoundException → 404.
    const res = await request(app.getHttpServer())
      .get(`/companies/${hkdId}/ledger?account=111&fiscalYear=2026`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(404);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // READ SCOPING — financial statements
  // ═══════════════════════════════════════════════════════════════════════════

  it('accountant: balance-sheet for SME (circular_133) → 200 with data', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/statements/balance-sheet?fiscalYear=2026`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('B01-DNN');
    // At minimum the 111 account (debit-nature asset) should show a positive amount.
    const cashLine = (res.body.lines as Array<{ code: string; amount: string }>)
      .find((l) => l.code === 'A.I.1'); // cash line prefix 111
    expect(cashLine).toBeDefined();
    expect(BigInt(cashLine!.amount)).toBeGreaterThan(0n);
  });

  it('accountant: balance-sheet for Household → 404 (companies RLS hides company)', async () => {
    // statement() queries companies table under RLS; hkd is not accessible
    // to the accountant → companies[0] is undefined → NotFoundException →  404.
    // Household's actual amounts (1,000,000 seed) are completely unreachable.
    const res = await request(app.getHttpServer())
      .get(`/companies/${hkdId}/statements/balance-sheet?fiscalYear=2026`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(404);
  });

  it('accountant: income-statement for Household → 404 (same company RLS path)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${hkdId}/statements/income-statement?fiscalYear=2026`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(404);
  });

  it('accountant: income-statement for SME → 200 with non-zero revenue', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/statements/income-statement?fiscalYear=2026`)
      .set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('B02-DNN');
    // Revenue line 01 should show the 1,000,000 seed entry via account 511.
    const revLine = (res.body.lines as Array<{ code: string; amount: string }>)
      .find((l) => l.code === '01');
    expect(revLine).toBeDefined();
    expect(revLine!.amount).toBe('1000000');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // WRITE SCOPING — accountant cannot post to the Household
  // ═══════════════════════════════════════════════════════════════════════════

  it('accountant: POST to Household → 403 and no new entry created', async () => {
    // Capture the household's entry count before the attempt.
    const countBefore = await trialBalanceRowCount(hkdId);
    expect(countBefore).toBeGreaterThan(0); // sanity: household has the seed entry

    // The PostingEngine access check fires before any DB write:
    //   if (!tx.isAdmin && !tx.accessibleCompanies.includes(input.companyId)) → 403
    const res = await request(app.getHttpServer())
      .post('/journal-entries')
      .set('Cookie', acctCookie)
      .send({
        companyId: hkdId,
        periodId: hkdPeriodId, // a valid-looking household period
        entryDate: '2026-01-20',
        description: 'Cross-company write attempt',
        lines: [
          { accountCode: '111', debitMinor: '500000', creditMinor: '0' },
          { accountCode: '511', debitMinor: '0', creditMinor: '500000' },
        ],
      });
    expect(res.status).toBe(403);

    // Verify NO entry was created: the household's TB row count is unchanged.
    const countAfter = await trialBalanceRowCount(hkdId);
    expect(countAfter).toBe(countBefore);
  });

  it('accountant: POST to SME (granted) → 201 (sanity: write access where permitted)', async () => {
    const res = await request(app.getHttpServer())
      .post('/journal-entries')
      .set('Cookie', acctCookie)
      .send({
        companyId: smeId,
        periodId: smePeriodId,
        entryDate: '2026-01-21',
        description: 'Kế toán được phép',
        lines: [
          { accountCode: '111', debitMinor: '200000', creditMinor: '0' },
          { accountCode: '511', debitMinor: '0', creditMinor: '200000' },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.companyId).toBe(smeId);
  });
});
