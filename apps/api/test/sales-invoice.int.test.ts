/**
 * Integration tests for sales-invoice create+post with effective-dated output VAT:
 *   - POST /companies/:id/sales-invoices  (createAndPost — posts immediately)
 *   - GET  /sales-invoices/:id
 *   - POST /sales-invoices/:id/cancel
 *
 * DB-backed, runs as the NOBYPASSRLS `erp` role (same setup as posting.int.test.ts),
 * so the P4 double-entry + immutability triggers are in force. Proves:
 *   - Dr 131 / Cr 511 / Cr 3331 posting with partnerId on the AR line,
 *   - bigint-exact VAT (HALF_UP), per-line vatRatePct recorded,
 *   - effective-dated rejection (8% window closed after 2026-12-31),
 *   - 3331 omitted for an all-exempt invoice,
 *   - cancel reverses the entry and nets AR back to zero,
 *   - invoiceNo increments per (company, fiscalYear),
 *   - a partnerId from another company is rejected.
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
let smeId: string;
let hkdId: string;
let customerId: string;
let hkdCustomerId: string;

/** Fetch the SME's open period for a given periodNo in FY2026. */
async function periodId(periodNo: number, fy = 2026): Promise<string> {
  const res = await request(app.getHttpServer())
    .get(`/companies/${smeId}/periods?fiscalYear=${fy}`)
    .set('Cookie', adminCookie);
  const p = res.body.find((x: { periodNo: number }) => x.periodNo === periodNo);
  if (!p) throw new Error(`period ${periodNo}/${fy} not found`);
  return p.id as string;
}

/** Seed the five VAT tax_rules (truncateAll clears the table each run). */
async function seedVatRules(): Promise<void> {
  await app.rawSql.unsafe(`
    INSERT INTO tax_rules (rule_type, value, effective_from, effective_to, source_regulation) VALUES
      ('vat_rate',         '10', '2014-01-01', NULL,         'Law on VAT 48/2024/QH15'),
      ('vat_rate_reduced', '8',  '2025-01-01', '2027-01-01', 'Resolution 204/2025/QH15'),
      ('vat_rate_5',       '5',  '2014-01-01', NULL,         'Law on VAT 48/2024/QH15'),
      ('vat_zero',         '0',  '2014-01-01', NULL,         'Law on VAT 48/2024/QH15'),
      ('vat_exempt',       '0',  '2014-01-01', NULL,         'Law on VAT 48/2024/QH15');
  `);
}

/**
 * Run a query inside an admin-context tx so FORCE RLS on company-scoped tables
 * is satisfied via the three GUCs (mirrors the request-path tenant tx).
 */
async function adminQuery<T>(
  companyId: string,
  sqlText: string,
): Promise<T[]> {
  return app.rawSql.begin(async (tx) => {
    await tx.unsafe(
      `SELECT set_config('app.user_id','00000000-0000-0000-0000-000000000001', true)`,
    );
    await tx.unsafe(`SELECT set_config('app.is_admin','true', true)`);
    await tx.unsafe(
      `SELECT set_config('app.accessible_companies','${companyId}', true)`,
    );
    return tx.unsafe(sqlText);
  }) as Promise<T[]>;
}

/** Account id for a code under a company (admin-context, RLS satisfied via GUC). */
async function accountId(companyId: string, code: string): Promise<string> {
  const rows = await adminQuery<{ id: string }>(
    companyId,
    `SELECT id FROM chart_of_accounts WHERE company_id = '${companyId}' AND code = '${code}'`,
  );
  return rows[0]!.id;
}

/** Sum of debit-credit on 131 for a given partner (admin GUC tx). */
async function arBalance(companyId: string, partnerId: string): Promise<bigint> {
  const acct131 = await accountId(companyId, '131');
  const rows = await adminQuery<{ bal: string }>(
    companyId,
    `SELECT COALESCE(SUM(debit_minor - credit_minor),0)::text AS bal
       FROM journal_lines
       WHERE company_id = '${companyId}' AND account_id = '${acct131}'
         AND partner_id = '${partnerId}'`,
  );
  return BigInt(rows[0]!.bal);
}

maybe('Sales invoice posting — effective-dated output VAT', () => {
  beforeAll(async () => {
    app = await makeApp();
    ({ adminCookie, smeId, hkdId } = await seedTwoCompaniesAndUsers(app));

    await seedVatRules();

    // Provision CoA for both companies (circular_133 / circular_88 both have 131/511/3331).
    for (const id of [smeId, hkdId]) {
      const prov = await request(app.getHttpServer())
        .post(`/companies/${id}/coa/provision`)
        .set('Cookie', adminCookie);
      expect(prov.status).toBe(200);
    }

    // FY2026 + FY2027 for the SME (FY2027 to prove the 8% window closed).
    for (const fy of [2026, 2027]) {
      const res = await request(app.getHttpServer())
        .post(`/companies/${smeId}/fiscal-years`)
        .set('Cookie', adminCookie)
        .send({ fiscalYear: fy });
      expect(res.status).toBe(200);
    }

    // Create a customer for the SME via the A4 endpoint.
    const cust = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'C001', name: 'Khách hàng A', partnerType: 'customer' });
    expect(cust.status).toBe(201);
    customerId = cust.body.id as string;

    // And a customer belonging to the OTHER company (for the cross-company test).
    const hkdCust = await request(app.getHttpServer())
      .post(`/companies/${hkdId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'H001', name: 'Khách HKD', partnerType: 'customer' });
    expect(hkdCust.status).toBe(201);
    hkdCustomerId = hkdCust.body.id as string;
  });

  afterAll(async () => {
    await closeApp(app);
  });

  // -------------------------------------------------------------------------
  // Two-line invoice: 10% + 8% (effective in 2026).
  // -------------------------------------------------------------------------
  it('two-line invoice (10% + 8%) → Dr 131 / Cr 511 / Cr 3331, balanced', async () => {
    const pid = await periodId(1);
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/sales-invoices`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: customerId,
        invoiceDate: '2026-03-15',
        periodId: pid,
        description: 'HĐ bán hàng 2 dòng',
        lines: [
          {
            description: 'Hàng A (10%)',
            quantity: '1',
            unitPriceMinor: '10000000',
            vatRuleType: 'vat_rate',
          },
          {
            description: 'Hàng B (8%)',
            quantity: '1',
            unitPriceMinor: '5000000',
            vatRuleType: 'vat_rate_reduced',
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('posted');
    expect(res.body.subtotalMinor).toBe('15000000');
    expect(res.body.vatMinor).toBe('1400000');
    expect(res.body.totalMinor).toBe('16400000');
    expect(res.body.invoiceNo).toBe(1);

    // Per-line vatRatePct recorded (10 and 8).
    const lines: Array<{ vatRatePct: number; vatMinor: string; lineNetMinor: string }> =
      res.body.lines;
    const lineA = lines.find((l) => l.lineNetMinor === '10000000')!;
    const lineB = lines.find((l) => l.lineNetMinor === '5000000')!;
    expect(lineA.vatRatePct).toBe(10);
    expect(lineA.vatMinor).toBe('1000000');
    expect(lineB.vatRatePct).toBe(8);
    expect(lineB.vatMinor).toBe('400000');

    // Inspect the posted journal entry.
    const je = await request(app.getHttpServer())
      .get(`/journal-entries/${res.body.journalEntryId}`)
      .set('Cookie', adminCookie);
    expect(je.status).toBe(200);
    expect(je.body.status).toBe('posted');

    const acct131 = await accountId(smeId, '131');
    const acct511 = await accountId(smeId, '511');
    const acct3331 = await accountId(smeId, '3331');

    const jl: Array<{
      accountId: string;
      debitMinor: string;
      creditMinor: string;
      partnerId: string | null;
    }> = je.body.lines;

    const dr131 = jl.find((l) => l.accountId === acct131)!;
    const cr511 = jl.find((l) => l.accountId === acct511)!;
    const cr3331 = jl.find((l) => l.accountId === acct3331)!;

    expect(dr131.debitMinor).toBe('16400000');
    expect(dr131.creditMinor).toBe('0');
    expect(dr131.partnerId).toBe(customerId);
    expect(cr511.creditMinor).toBe('15000000');
    expect(cr3331.creditMinor).toBe('1400000');

    // Balanced.
    const totDr = jl.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const totCr = jl.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(totDr).toBe(totCr);
    expect(totDr).toBe(16400000n);
  });

  // -------------------------------------------------------------------------
  // Exempt line → vat 0, NO 3331 line (Dr 131 = Cr 511).
  // -------------------------------------------------------------------------
  it('all-exempt invoice → no 3331 line, Dr 131 = Cr 511', async () => {
    const pid = await periodId(1);
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/sales-invoices`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: customerId,
        invoiceDate: '2026-03-16',
        periodId: pid,
        lines: [
          {
            description: 'Dịch vụ miễn thuế',
            quantity: '1',
            unitPriceMinor: '2000000',
            vatRuleType: 'vat_exempt',
          },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.vatMinor).toBe('0');
    expect(res.body.totalMinor).toBe('2000000');
    expect(res.body.invoiceNo).toBe(2);

    const je = await request(app.getHttpServer())
      .get(`/journal-entries/${res.body.journalEntryId}`)
      .set('Cookie', adminCookie);
    const acct3331 = await accountId(smeId, '3331');
    const jl: Array<{ accountId: string; debitMinor: string; creditMinor: string }> =
      je.body.lines;
    expect(jl.find((l) => l.accountId === acct3331)).toBeUndefined();
    expect(jl).toHaveLength(2); // 131 + 511 only
    const totDr = jl.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const totCr = jl.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(totDr).toBe(2000000n);
    expect(totCr).toBe(2000000n);
  });

  // -------------------------------------------------------------------------
  // 2027 invoice with vat_rate_reduced → 422 (8% window closed). Nothing persists.
  // -------------------------------------------------------------------------
  it('2027 invoice with vat_rate_reduced → 422, invoiceNo unaffected', async () => {
    const pid2027 = await periodId(1, 2027);

    const before = (await app.rawSql.unsafe(
      `SELECT COALESCE(MAX(invoice_no),0)::text AS m FROM sales_invoices
       WHERE company_id='${smeId}' AND fiscal_year=2027`,
    )) as Array<{ m: string }>;

    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/sales-invoices`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: customerId,
        invoiceDate: '2027-01-02',
        periodId: pid2027,
        lines: [
          {
            description: 'Hàng (8% đã hết hạn)',
            quantity: '1',
            unitPriceMinor: '1000000',
            vatRuleType: 'vat_rate_reduced',
          },
        ],
      });
    expect(res.status).toBe(422);

    const after = (await app.rawSql.unsafe(
      `SELECT COALESCE(MAX(invoice_no),0)::text AS m FROM sales_invoices
       WHERE company_id='${smeId}' AND fiscal_year=2027`,
    )) as Array<{ m: string }>;
    expect(after[0]!.m).toBe(before[0]!.m); // nothing persisted
  });

  // -------------------------------------------------------------------------
  // HALF_UP exactness: net 10,005 @ 10% → 1000.5 → 1001.
  // -------------------------------------------------------------------------
  it('HALF_UP VAT rounding: net 10,005 @ 10% → vat 1001', async () => {
    const pid = await periodId(1);
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/sales-invoices`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: customerId,
        invoiceDate: '2026-03-17',
        periodId: pid,
        lines: [
          {
            description: 'Làm tròn',
            quantity: '1',
            unitPriceMinor: '10005',
            vatRuleType: 'vat_rate',
          },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.vatMinor).toBe('1001');
    expect(res.body.totalMinor).toBe('11006');
  });

  // -------------------------------------------------------------------------
  // invoiceNo increments per (company, fiscalYear).
  // -------------------------------------------------------------------------
  it('invoiceNo increments per (company, fiscalYear)', async () => {
    const pid = await periodId(1);
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/sales-invoices`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: customerId,
        invoiceDate: '2026-03-18',
        periodId: pid,
        lines: [
          {
            description: 'Tiếp theo',
            quantity: '1',
            unitPriceMinor: '1000000',
            vatRuleType: 'vat_rate',
          },
        ],
      });
    expect(res.status).toBe(201);
    // Invoices 1 (two-line), 2 (exempt), 3 (rounding) precede this → 4.
    expect(res.body.invoiceNo).toBe(4);
  });

  // -------------------------------------------------------------------------
  // Cancel → journal entry reversed, AR nets back to zero.
  // -------------------------------------------------------------------------
  it('cancel reverses the entry; customer AR nets back to zero', async () => {
    const pid = await periodId(1);
    // Use a fresh customer so the AR sum is isolated.
    const cust = await request(app.getHttpServer())
      .post(`/companies/${smeId}/partners`)
      .set('Cookie', adminCookie)
      .send({ code: 'C-CANCEL', name: 'KH hủy', partnerType: 'customer' });
    const cancelCustomer = cust.body.id as string;

    const inv = await request(app.getHttpServer())
      .post(`/companies/${smeId}/sales-invoices`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: cancelCustomer,
        invoiceDate: '2026-03-19',
        periodId: pid,
        lines: [
          {
            description: 'Sẽ hủy',
            quantity: '1',
            unitPriceMinor: '7000000',
            vatRuleType: 'vat_rate',
          },
        ],
      });
    expect(inv.status).toBe(201);
    // AR after posting = total = 7,700,000.
    expect(await arBalance(smeId, cancelCustomer)).toBe(7700000n);

    const cancel = await request(app.getHttpServer())
      .post(`/sales-invoices/${inv.body.id}/cancel`)
      .set('Cookie', adminCookie);
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('cancelled');

    // The original journal entry is now 'reversed'.
    const je = await request(app.getHttpServer())
      .get(`/journal-entries/${inv.body.journalEntryId}`)
      .set('Cookie', adminCookie);
    expect(je.body.status).toBe('reversed');

    // AR back to zero.
    expect(await arBalance(smeId, cancelCustomer)).toBe(0n);

    // Cancelling again → 422 (not posted anymore).
    const again = await request(app.getHttpServer())
      .post(`/sales-invoices/${inv.body.id}/cancel`)
      .set('Cookie', adminCookie);
    expect(again.status).toBe(422);
  });

  // -------------------------------------------------------------------------
  // partnerId must belong to the company → 422.
  // -------------------------------------------------------------------------
  it('partnerId from another company → 422', async () => {
    const pid = await periodId(1);
    const res = await request(app.getHttpServer())
      .post(`/companies/${smeId}/sales-invoices`)
      .set('Cookie', adminCookie)
      .send({
        partnerId: hkdCustomerId, // belongs to hkdId, not smeId
        invoiceDate: '2026-03-20',
        periodId: pid,
        lines: [
          {
            description: 'Sai khách',
            quantity: '1',
            unitPriceMinor: '1000000',
            vatRuleType: 'vat_rate',
          },
        ],
      });
    expect(res.status).toBe(422);
  });

  // -------------------------------------------------------------------------
  // GET unknown invoice → 404.
  // -------------------------------------------------------------------------
  it('GET unknown invoice → 404', async () => {
    const res = await request(app.getHttpServer())
      .get('/sales-invoices/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });
});
