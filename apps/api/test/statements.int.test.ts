/**
 * Integration tests for the Circular 133 financial-statement engine:
 *   - GET /companies/:id/statements/balance-sheet?fiscalYear=<int>&through=<int>   (B01-DNN)
 *   - GET /companies/:id/statements/income-statement?fiscalYear=<int>&through=<int> (B02-DNN)
 *
 * Correctness crux verified with a small, hand-computable dataset:
 *
 *   Entries (period 1 unless noted):
 *     E1 owner capital:     Dr 111 (cash)        2,000,000 / Cr 411 (vốn CSH) 2,000,000
 *     E2 pre-seed inventory:Dr 156 (inventory)     600,000 / Cr 411           600,000
 *     E3 cash sale:         Dr 111 (cash)        1,000,000 / Cr 511 (revenue) 1,000,000
 *     E4 COGS:              Dr 632                 600,000 / Cr 156             600,000
 *     E5 fixed asset:       Dr 211 (TSCĐ HH)     1,000,000 / Cr 411         1,000,000
 *     E6 depreciation:      Dr 642 (CP QLKD)       100,000 / Cr 2141 (hao mòn) 100,000
 *
 *   NOTE on the cash sale: we collect the sale in cash (111), not receivable (131),
 *   on purpose. In the B01-DNN template account 131 is mapped on BOTH sides — as a
 *   receivable (A.I.3a, debit-nature) and as a customer advance (B.I.2, credit-nature) —
 *   so a single aggregate 131 balance would appear once positive on the asset side and
 *   once negative on the resources side, an inherent limitation of prefix + aggregate-
 *   balance mapping (faithful per-sub-ledger split is deferred). Using cash sidesteps
 *   that overlap and keeps every line hand-verifiable.
 *
 *   Income Statement (B02-DNN, through=12), hand-computed:
 *     01 revenue            = 1,000,000   (511, credit-nature)
 *     11 COGS               =   600,000   (632, debit)
 *     20 gross profit       =   400,000   (10 − 11 = (01−02) − 11)
 *     26 admin expense      =   100,000   (642)
 *     30 operating profit   =   300,000   (20 + 21 − 22 − 25 − 26)
 *     60 net result         =   300,000   (50 − 51 − 52)
 *
 *   _neg correctness (B01, through=12) — net fixed assets subtotal A.II.2:
 *     A.II.2a cost 211       = 1,000,000
 *     A.II.2b deprec 2141    =   100,000  (credit-nature, subtracted via _neg)
 *     A.II.2  net            =   900,000  → proves depreciation SUBTRACTS
 *
 *   Balance-sheet identity:
 *     at through=12 (pre-closing): TOTAL_A (3,900,000) − TOTAL_B (3,600,000) = 300,000 = profit
 *     Closing entry in special period 13 (simplified, balanced, zeroes P&L, credits 421):
 *       Dr 511 1,000,000 / Cr 632 600,000, Cr 642 100,000, Cr 421 300,000
 *     at through=13 (post-closing): TOTAL_A == TOTAL_B (3,900,000) — accounting identity holds.
 *
 *   Regime without template: household (circular_88) balance-sheet → 404.
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
let hkdId: string;

async function getPeriodId(companyId: string, fiscalYear: number, periodNo: number): Promise<string> {
  const res = await request(app.getHttpServer())
    .get(`/companies/${companyId}/periods?fiscalYear=${fiscalYear}`)
    .set('Cookie', adminCookie);
  expect(res.status).toBe(200);
  const p = res.body.find((x: { periodNo: number }) => x.periodNo === periodNo);
  if (!p) throw new Error(`period ${periodNo}/${fiscalYear} not found`);
  return p.id as string;
}

async function postEntry(
  companyId: string,
  periodId: string,
  entryDate: string,
  description: string,
  lines: Array<{ accountCode: string; debitMinor: string; creditMinor: string }>,
) {
  const res = await request(app.getHttpServer())
    .post('/journal-entries')
    .set('Cookie', adminCookie)
    .send({ companyId, periodId, entryDate, description, lines });
  expect(res.status).toBe(201);
  return res.body as { id: string; entryNo: number; status: string };
}

interface StatementBody {
  id: string;
  title_vi: string;
  lines: Array<{ code: string; label_vi: string; level: number; amount: string }>;
}

async function getBalanceSheet(companyId: string, fiscalYear: number, through?: number) {
  let url = `/companies/${companyId}/statements/balance-sheet?fiscalYear=${fiscalYear}`;
  if (through !== undefined) url += `&through=${through}`;
  const res = await request(app.getHttpServer()).get(url).set('Cookie', adminCookie);
  expect(res.status).toBe(200);
  return res.body as StatementBody;
}

async function getIncomeStatement(companyId: string, fiscalYear: number, through?: number) {
  let url = `/companies/${companyId}/statements/income-statement?fiscalYear=${fiscalYear}`;
  if (through !== undefined) url += `&through=${through}`;
  const res = await request(app.getHttpServer()).get(url).set('Cookie', adminCookie);
  expect(res.status).toBe(200);
  return res.body as StatementBody;
}

function amount(stmt: StatementBody, code: string): string {
  const line = stmt.lines.find((l) => l.code === code);
  if (!line) throw new Error(`statement line ${code} not found`);
  return line.amount;
}

maybe('Circular 133 Balance Sheet + Income Statement', () => {
  beforeAll(async () => {
    app = await makeApp();
    ({ adminCookie, smeId, hkdId } = await seedTwoCompaniesAndUsers(app));

    // Provision CoA for SME (circular_133).
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

    const pid1 = await getPeriodId(smeId, 2026, 1);

    // E1: Dr 111 2,000,000 / Cr 411 2,000,000
    await postEntry(smeId, pid1, '2026-01-05', 'Góp vốn chủ sở hữu', [
      { accountCode: '111', debitMinor: '2000000', creditMinor: '0' },
      { accountCode: '411', debitMinor: '0', creditMinor: '2000000' },
    ]);
    // E2: Dr 156 600,000 / Cr 411 600,000 (pre-seed inventory)
    await postEntry(smeId, pid1, '2026-01-06', 'Nhập kho hàng hóa ban đầu', [
      { accountCode: '156', debitMinor: '600000', creditMinor: '0' },
      { accountCode: '411', debitMinor: '0', creditMinor: '600000' },
    ]);
    // E3: Dr 111 1,000,000 / Cr 511 1,000,000 (cash sale; see NOTE re: 131 overlap)
    await postEntry(smeId, pid1, '2026-01-10', 'Bán hàng thu tiền mặt', [
      { accountCode: '111', debitMinor: '1000000', creditMinor: '0' },
      { accountCode: '511', debitMinor: '0', creditMinor: '1000000' },
    ]);
    // E4: Dr 632 600,000 / Cr 156 600,000 (COGS)
    await postEntry(smeId, pid1, '2026-01-10', 'Giá vốn hàng bán', [
      { accountCode: '632', debitMinor: '600000', creditMinor: '0' },
      { accountCode: '156', debitMinor: '0', creditMinor: '600000' },
    ]);
    // E5: Dr 211 1,000,000 / Cr 411 1,000,000 (fixed asset purchased w/ capital)
    await postEntry(smeId, pid1, '2026-01-12', 'Mua tài sản cố định', [
      { accountCode: '211', debitMinor: '1000000', creditMinor: '0' },
      { accountCode: '411', debitMinor: '0', creditMinor: '1000000' },
    ]);
    // E6: Dr 642 100,000 / Cr 2141 100,000 (depreciation)
    await postEntry(smeId, pid1, '2026-01-31', 'Khấu hao TSCĐ', [
      { accountCode: '642', debitMinor: '100000', creditMinor: '0' },
      { accountCode: '2141', debitMinor: '0', creditMinor: '100000' },
    ]);
  });

  afterAll(async () => {
    await closeApp(app);
  });

  // ---------------------------------------------------------------------------
  // Income Statement (B02-DNN) — leaf prefix+nature + _neg subtotals
  // ---------------------------------------------------------------------------
  it('income statement through=12: revenue/COGS/gross-profit/net hand-verified', async () => {
    const is = await getIncomeStatement(smeId, 2026, 12);
    expect(is.id).toBe('B02-DNN');
    expect(is.title_vi).toBe('Báo cáo kết quả hoạt động kinh doanh');

    expect(amount(is, '01')).toBe('1000000'); // revenue (511, credit-nature)
    expect(amount(is, '02')).toBe('0');        // no deductions
    expect(amount(is, '10')).toBe('1000000');  // net revenue = 01 − 02
    expect(amount(is, '11')).toBe('600000');   // COGS (632)
    expect(amount(is, '20')).toBe('400000');   // gross profit = 10 − 11
    expect(amount(is, '26')).toBe('100000');   // admin expense (642)
    expect(amount(is, '30')).toBe('300000');   // operating = 20 + 21 − 22 − 25 − 26
    expect(amount(is, '50')).toBe('300000');   // pre-tax = 30 + 40
    expect(amount(is, '60')).toBe('300000');   // net = 50 − 51 − 52

    // Line order is preserved from the template.
    const codes = is.lines.map((l) => l.code);
    expect(codes[0]).toBe('01');
    expect(codes[codes.length - 1]).toBe('60');
  });

  // ---------------------------------------------------------------------------
  // _neg correctness in B01: depreciation SUBTRACTS from net fixed assets.
  // ---------------------------------------------------------------------------
  it('balance sheet through=12: net fixed-asset subtotal = cost − depreciation (_neg works)', async () => {
    const bs = await getBalanceSheet(smeId, 2026, 12);
    expect(bs.id).toBe('B01-DNN');

    expect(amount(bs, 'A.II.2a')).toBe('1000000'); // cost (211)
    expect(amount(bs, 'A.II.2b')).toBe('100000');  // accumulated depreciation (2141, credit-nature, positive)
    // A.II.2 = 2a − 2b(_neg) + others(0) = 1,000,000 − 100,000 = 900,000
    expect(amount(bs, 'A.II.2')).toBe('900000');

    // Other asset lines sanity-check.
    expect(amount(bs, 'A.I.1')).toBe('3000000'); // cash (111): 2,000,000 + 1,000,000 sale
    expect(amount(bs, 'A.I.4a')).toBe('0');       // inventory netted out (156: 600k − 600k)
  });

  // ---------------------------------------------------------------------------
  // Balance-sheet identity: pre-closing they differ by profit; post-closing balances.
  // ---------------------------------------------------------------------------
  it('balance sheet identity: differs by profit pre-closing, balances post-closing', async () => {
    // through=12 (pre-closing): assets exceed resources by the period profit (300,000).
    const bs12 = await getBalanceSheet(smeId, 2026, 12);
    const totalA12 = BigInt(amount(bs12, 'TOTAL_A'));
    const totalB12 = BigInt(amount(bs12, 'TOTAL_B'));
    expect(totalA12).toBe(3900000n);
    expect(totalB12).toBe(3600000n);
    expect(totalA12 - totalB12).toBe(300000n); // == net profit, retained earnings not yet booked

    // Closing entry in special period 13 (simplified, balanced, zeroes P&L, credits 421):
    //   Dr 511 1,000,000 / Cr 632 600,000, Cr 642 100,000, Cr 421 300,000
    const pid13 = await getPeriodId(smeId, 2026, 13);
    await postEntry(smeId, pid13, '2026-12-31', 'Kết chuyển lãi lỗ cuối năm', [
      { accountCode: '511', debitMinor: '1000000', creditMinor: '0' },
      { accountCode: '632', debitMinor: '0', creditMinor: '600000' },
      { accountCode: '642', debitMinor: '0', creditMinor: '100000' },
      { accountCode: '421', debitMinor: '0', creditMinor: '300000' },
    ]);

    // through=13 (post-closing): the accounting identity holds.
    const bs13 = await getBalanceSheet(smeId, 2026, 13);
    const totalA13 = BigInt(amount(bs13, 'TOTAL_A'));
    const totalB13 = BigInt(amount(bs13, 'TOTAL_B'));
    expect(totalA13).toBe(3900000n);
    expect(totalB13).toBe(3900000n);
    expect(totalA13).toBe(totalB13); // TỔNG TÀI SẢN == TỔNG NGUỒN VỐN

    // Retained earnings now carries the profit; capital unchanged.
    expect(amount(bs13, 'B.II.5')).toBe('300000'); // 421
    expect(amount(bs13, 'B.II.1')).toBe('3600000'); // 411

    // Post-closing the income statement P&L accounts are zeroed.
    const is13 = await getIncomeStatement(smeId, 2026, 13);
    expect(amount(is13, '01')).toBe('0');
    expect(amount(is13, '11')).toBe('0');
    expect(amount(is13, '60')).toBe('0');
  });

  // ---------------------------------------------------------------------------
  // Default through=12.
  // ---------------------------------------------------------------------------
  it('default through=12 excludes the period-13 closing entry', async () => {
    const bsDefault = await getBalanceSheet(smeId, 2026);
    expect(amount(bsDefault, 'B.II.5')).toBe('0'); // 421 not yet credited at through=12
    expect(BigInt(amount(bsDefault, 'TOTAL_A'))).toBe(3900000n);
    expect(BigInt(amount(bsDefault, 'TOTAL_B'))).toBe(3600000n);
  });

  // ---------------------------------------------------------------------------
  // Regime without template → 404.
  // ---------------------------------------------------------------------------
  it('household (circular_88) balance sheet → 404 (no template for regime)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${hkdId}/statements/balance-sheet?fiscalYear=2026`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });

  it('income statement requires fiscalYear param → 400 if missing', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/statements/income-statement`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });

  it('unauthenticated request → 401', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${smeId}/statements/balance-sheet?fiscalYear=2026`);
    expect(res.status).toBe(401);
  });
});
