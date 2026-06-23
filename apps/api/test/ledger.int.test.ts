/**
 * Integration tests for General Ledger + Trial Balance read services and endpoints:
 *   - GET /companies/:id/trial-balance?fiscalYear=<int>&through=<int>
 *   - GET /companies/:id/ledger?account=<code>&fiscalYear=<int>&through=<int>
 *
 * Correctness crux verified:
 *   1. Trial balance totals balance (totals.debit === totals.credit).
 *   2. status <> 'draft' semantics: reversed entries net to zero — the original
 *      (status=reversed) AND the reversal (status=posted) both appear in the TB,
 *      and their lines cancel out. Filtering to only 'posted' would corrupt the books.
 *   3. Cumulative through-period: entries in special periods (periodNo >= 13) are
 *      excluded when through=12 but included when through=15.
 *   4. General ledger movements are ordered chronologically with correct running balance.
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
let smeId: string;

/** Fetch the open period of a given periodNo for the SME's fiscal year. */
async function getPeriodId(fiscalYear: number, periodNo: number): Promise<string> {
  const res = await request(app.getHttpServer())
    .get(`/companies/${smeId}/periods?fiscalYear=${fiscalYear}`)
    .set('Cookie', adminCookie);
  expect(res.status).toBe(200);
  const p = res.body.find((x: { periodNo: number }) => x.periodNo === periodNo);
  if (!p) throw new Error(`period ${periodNo}/${fiscalYear} not found`);
  return p.id as string;
}

/** Post a journal entry via the API and return the entry body. */
async function postEntry(
  periodId: string,
  entryDate: string,
  description: string,
  lines: Array<{ accountCode: string; debitMinor: string; creditMinor: string }>,
) {
  const res = await request(app.getHttpServer())
    .post('/journal-entries')
    .set('Cookie', adminCookie)
    .send({ companyId: smeId, periodId, entryDate, description, lines });
  expect(res.status).toBe(201);
  return res.body as { id: string; entryNo: number; status: string };
}

/** Reverse an entry and return the reversing entry body. */
async function reverseEntry(entryId: string) {
  const res = await request(app.getHttpServer())
    .post(`/journal-entries/${entryId}/reverse`)
    .set('Cookie', adminCookie)
    .send({});
  expect(res.status).toBe(201);
  return res.body;
}

/** GET trial balance helper. */
async function getTrialBalance(fiscalYear: number, through?: number) {
  let url = `/companies/${smeId}/trial-balance?fiscalYear=${fiscalYear}`;
  if (through !== undefined) url += `&through=${through}`;
  const res = await request(app.getHttpServer())
    .get(url)
    .set('Cookie', adminCookie);
  expect(res.status).toBe(200);
  return res.body as {
    fiscalYear: number;
    throughPeriodNo: number;
    rows: Array<{ accountId: string; code: string; name: string; debit: string; credit: string; balance: string }>;
    totals: { debit: string; credit: string };
  };
}

/** GET general ledger helper. */
async function getLedger(accountCode: string, fiscalYear: number, through?: number) {
  let url = `/companies/${smeId}/ledger?account=${accountCode}&fiscalYear=${fiscalYear}`;
  if (through !== undefined) url += `&through=${through}`;
  const res = await request(app.getHttpServer())
    .get(url)
    .set('Cookie', adminCookie);
  expect(res.status).toBe(200);
  return res.body as {
    accountCode: string;
    name: string;
    openingBalance: string;
    movements: Array<{ entryNo: number; entryDate: string; description: string; debit: string; credit: string; runningBalance: string }>;
    closingBalance: string;
  };
}

maybe('General Ledger + Trial Balance', () => {
  beforeAll(async () => {
    app = await makeApp();
    ({ adminCookie, smeId } = await seedTwoCompaniesAndUsers(app));

    // Provision CoA for SME (circular_133 — includes 111/511/632/156/642).
    const prov = await request(app.getHttpServer())
      .post(`/companies/${smeId}/coa/provision`)
      .set('Cookie', adminCookie);
    expect(prov.status).toBe(200);
    expect(prov.body.inserted).toBeGreaterThan(0);

    // FY2026: 12 regular periods + special period 13 (closing).
    const fy = await request(app.getHttpServer())
      .post(`/companies/${smeId}/fiscal-years`)
      .set('Cookie', adminCookie)
      .send({
        fiscalYear: 2026,
        specialPeriods: [{ periodNo: 13, purpose: 'closing', nameVi: 'Khóa sổ' }],
      });
    expect(fy.status).toBe(200);
  });

  afterAll(async () => {
    await closeApp(app);
  });

  // ---------------------------------------------------------------------------
  // Core entries: E1 (cash/revenue) and E2 (COGS/inventory)
  // Hand-computed expected values:
  //   111 (Tiền mặt/Cash): debit=1_000_000, credit=0, balance=1_000_000
  //   511 (Doanh thu bán hàng/Revenue): debit=0, credit=1_000_000, balance=-1_000_000
  //   632 (Giá vốn hàng bán/COGS): debit=600_000, credit=0, balance=600_000
  //   156 (Hàng hóa/Inventory): debit=0, credit=600_000, balance=-600_000
  //   totals.debit = 1_600_000, totals.credit = 1_600_000
  // ---------------------------------------------------------------------------

  it('trial balance with two known entries → balanced totals and correct row values', async () => {
    const pid1 = await getPeriodId(2026, 1);

    // E1: Dr 111 (cash) 1,000,000 / Cr 511 (revenue) 1,000,000
    await postEntry(pid1, '2026-01-15', 'Thu tiền mặt từ bán hàng', [
      { accountCode: '111', debitMinor: '1000000', creditMinor: '0' },
      { accountCode: '511', debitMinor: '0', creditMinor: '1000000' },
    ]);

    // E2: Dr 632 (COGS) 600,000 / Cr 156 (inventory) 600,000
    await postEntry(pid1, '2026-01-15', 'Xuất kho hàng bán', [
      { accountCode: '632', debitMinor: '600000', creditMinor: '0' },
      { accountCode: '156', debitMinor: '0', creditMinor: '600000' },
    ]);

    const tb = await getTrialBalance(2026, 12);

    // Structural assertions.
    expect(tb.fiscalYear).toBe(2026);
    expect(tb.throughPeriodNo).toBe(12);
    expect(Array.isArray(tb.rows)).toBe(true);

    // Totals MUST balance.
    expect(tb.totals.debit).toBe('1600000');
    expect(tb.totals.credit).toBe('1600000');

    // Account-level assertions (hand-computed).
    const row111 = tb.rows.find((r) => r.code === '111');
    expect(row111).toBeDefined();
    expect(row111!.debit).toBe('1000000');
    expect(row111!.credit).toBe('0');
    expect(row111!.balance).toBe('1000000'); // debit-normal

    const row511 = tb.rows.find((r) => r.code === '511');
    expect(row511).toBeDefined();
    expect(row511!.debit).toBe('0');
    expect(row511!.credit).toBe('1000000');
    expect(row511!.balance).toBe('-1000000'); // credit-normal → negative balance

    const row632 = tb.rows.find((r) => r.code === '632');
    expect(row632).toBeDefined();
    expect(row632!.debit).toBe('600000');
    expect(row632!.credit).toBe('0');
    expect(row632!.balance).toBe('600000');

    const row156 = tb.rows.find((r) => r.code === '156');
    expect(row156).toBeDefined();
    expect(row156!.debit).toBe('0');
    expect(row156!.credit).toBe('600000');
    expect(row156!.balance).toBe('-600000');

    // Rows are ordered by account code.
    const codes = tb.rows.map((r) => r.code);
    expect(codes).toEqual([...codes].sort());
  });

  // ---------------------------------------------------------------------------
  // Reversal nets to zero: status <> 'draft' correctness test
  //
  // Post E3, snapshot the TB, then reverse E3.
  // After reversal the TB for the affected accounts must be IDENTICAL to before E3.
  // This proves:
  //   - The original E3 (status='reversed') IS included (its lines counted).
  //   - The reversing entry B (status='posted') IS included (its swapped lines cancel).
  //   - Together they net to zero — accounts unchanged vs the pre-E3 snapshot.
  //   If we had filtered status='posted' only, E3 would be excluded and B's lines
  //   would stand alone, corrupting the balances.
  // ---------------------------------------------------------------------------

  it('reversal nets to zero — status<>draft semantics proven correct', async () => {
    const pid1 = await getPeriodId(2026, 1);

    // Snapshot before E3: capture balances for accounts 111 and 511.
    const tbBefore = await getTrialBalance(2026, 12);
    const row111Before = tbBefore.rows.find((r) => r.code === '111');
    const row511Before = tbBefore.rows.find((r) => r.code === '511');
    const balanceBefore111 = row111Before?.balance ?? '0';
    const balanceBefore511 = row511Before?.balance ?? '0';

    // Post E3: Dr 111 200,000 / Cr 511 200,000.
    const e3 = await postEntry(pid1, '2026-01-20', 'Cần đảo - E3', [
      { accountCode: '111', debitMinor: '200000', creditMinor: '0' },
      { accountCode: '511', debitMinor: '0', creditMinor: '200000' },
    ]);

    // Verify E3 shows up in the TB (before reversal).
    const tbWithE3 = await getTrialBalance(2026, 12);
    const row111WithE3 = tbWithE3.rows.find((r) => r.code === '111');
    expect(row111WithE3!.debit).toBe((BigInt(balanceBefore111) + 200000n).toString());

    // Reverse E3 — creates E4 (status=posted), marks E3 status=reversed.
    await reverseEntry(e3.id);

    // After reversal: TB must match the pre-E3 snapshot exactly.
    const tbAfter = await getTrialBalance(2026, 12);
    const row111After = tbAfter.rows.find((r) => r.code === '111');
    const row511After = tbAfter.rows.find((r) => r.code === '511');

    // The reversal netted to zero — balances are back to what they were before E3.
    expect(row111After!.balance).toBe(balanceBefore111);
    expect(row511After!.balance).toBe(balanceBefore511);

    // Totals still balance even with the reversed pair.
    expect(tbAfter.totals.debit).toBe(tbAfter.totals.credit);
  });

  // ---------------------------------------------------------------------------
  // Cumulative through-period: special period 13 vs through=12
  //
  // Post an adjustment entry in period 13 (special/closing period):
  //   E5: Dr 642 (Chi phí quản lý/Admin expense) 50,000 / Cr 111 (Cash) 50,000
  // trialBalance(through=12) MUST NOT include it.
  // trialBalance(through=15) MUST include it (since 13 <= 15).
  // ---------------------------------------------------------------------------

  it('through-period cumulative: special period 13 excluded at through=12, included at through=15', async () => {
    const pid13 = await getPeriodId(2026, 13);

    // E5: adjustment in period 13.
    await postEntry(pid13, '2026-12-31', 'Điều chỉnh cuối năm - kỳ 13', [
      { accountCode: '642', debitMinor: '50000', creditMinor: '0' },
      { accountCode: '111', debitMinor: '0', creditMinor: '50000' },
    ]);

    // through=12: period 13 is excluded → account 642 should have NO row (balance=0).
    const tbThrough12 = await getTrialBalance(2026, 12);
    const row642Through12 = tbThrough12.rows.find((r) => r.code === '642');
    expect(row642Through12).toBeUndefined(); // 642 not in the TB at through=12

    // through=15: period 13 is included (13 <= 15) → account 642 has balance 50,000.
    const tbThrough15 = await getTrialBalance(2026, 15);
    const row642Through15 = tbThrough15.rows.find((r) => r.code === '642');
    expect(row642Through15).toBeDefined();
    expect(row642Through15!.debit).toBe('50000');
    expect(row642Through15!.balance).toBe('50000');

    // Also verify account 111 differs between the two:
    // At through=12 it has whatever balance E1+E3_reversal gave it.
    // At through=15 it has that minus 50,000 (credit from E5).
    const row111T12 = tbThrough12.rows.find((r) => r.code === '111');
    const row111T15 = tbThrough15.rows.find((r) => r.code === '111');
    const diff =
      BigInt(row111T12?.balance ?? '0') - BigInt(row111T15?.balance ?? '0');
    expect(diff).toBe(50000n); // E5 credited 111 by 50,000 → balance drops by that

    // Both through=12 and through=15 totals are still internally balanced.
    expect(tbThrough12.totals.debit).toBe(tbThrough12.totals.credit);
    expect(tbThrough15.totals.debit).toBe(tbThrough15.totals.credit);

    // Default (no through param) should equal through=12.
    const tbDefault = await getTrialBalance(2026);
    expect(tbDefault.throughPeriodNo).toBe(12);
    expect(tbDefault.totals.debit).toBe(tbThrough12.totals.debit);
    expect(tbDefault.totals.credit).toBe(tbThrough12.totals.credit);
  });

  // ---------------------------------------------------------------------------
  // General ledger: account 111 movements in order, running balance correct.
  //
  // After all entries above (in the same beforeAll-seeded test run):
  //   E1: Dr 111 1,000,000 → runningBalance = 1,000,000
  //   E3: Dr 111 200,000   → runningBalance = 1,200,000
  //   E3_REV: Cr 111 200,000 → runningBalance = 1,000,000  (reversal nets E3)
  // at through=12 (excludes period 13's E5 which Cr 111 50,000).
  // closingBalance should equal the TB balance for 111.
  // ---------------------------------------------------------------------------

  it('general ledger for account 111: movements in order, running balance matches TB', async () => {
    const gl = await getLedger('111', 2026, 12);

    expect(gl.accountCode).toBe('111');
    expect(gl.openingBalance).toBe('0'); // Phase 1: always zero

    // Movements must be non-empty (we posted entries with 111).
    expect(gl.movements.length).toBeGreaterThan(0);

    // Running balance sequence must be monotonically consistent:
    // Each movement: runningBalance[i] = runningBalance[i-1] + debit[i] - credit[i]
    let running = 0n;
    for (const m of gl.movements) {
      running += BigInt(m.debit) - BigInt(m.credit);
      expect(m.runningBalance).toBe(running.toString());
    }

    // closingBalance must equal the final runningBalance.
    expect(gl.closingBalance).toBe(running.toString());

    // closingBalance must match the TB balance for account 111.
    const tb = await getTrialBalance(2026, 12);
    const row111 = tb.rows.find((r) => r.code === '111');
    expect(row111).toBeDefined();
    expect(gl.closingBalance).toBe(row111!.balance);

    // Movements ordered by entryDate ASC then entryNo ASC.
    for (let i = 1; i < gl.movements.length; i++) {
      const prev = gl.movements[i - 1]!;
      const curr = gl.movements[i]!;
      if (prev.entryDate === curr.entryDate) {
        expect(curr.entryNo).toBeGreaterThanOrEqual(prev.entryNo);
      } else {
        expect(curr.entryDate >= prev.entryDate).toBe(true);
      }
    }
  });

  it('general ledger for account 111 at through=15 includes period-13 entry', async () => {
    const gl12 = await getLedger('111', 2026, 12);
    const gl15 = await getLedger('111', 2026, 15);

    // At through=15 there is one more movement (E5 Cr 111 50,000 in period 13).
    expect(gl15.movements.length).toBe(gl12.movements.length + 1);
    // closingBalance drops by 50,000.
    const diff = BigInt(gl12.closingBalance) - BigInt(gl15.closingBalance);
    expect(diff).toBe(50000n);
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  it('trial balance with no entries in the fiscal year returns empty rows + zero totals', async () => {
    // Use a fiscal year we haven't posted into (2099 is within schema max 2100).
    const fy2099 = await request(app.getHttpServer())
      .post(`/companies/${smeId}/fiscal-years`)
      .set('Cookie', adminCookie)
      .send({ fiscalYear: 2099 });
    expect(fy2099.status).toBe(200);

    const tb = await getTrialBalance(2099, 12);
    expect(tb.rows).toHaveLength(0);
    expect(tb.totals.debit).toBe('0');
    expect(tb.totals.credit).toBe('0');
  });

  it('general ledger for unknown account code → 404', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ledger?account=XXXXXX&fiscalYear=2026&through=12`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });

  it('trial balance requires fiscalYear param → 400 if missing', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/trial-balance`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });

  it('general ledger requires account and fiscalYear params → 400 if missing', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/ledger?fiscalYear=2026`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });

  it('unauthenticated request → 401', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/trial-balance?fiscalYear=2026`);
    expect(res.status).toBe(401);
  });
});
