# Phase 2a — Sales Billing → AR → Receipts (Design)

**Date:** 2026-06-23
**Status:** Draft for review
**Builds on:** Phase 1 accounting core (merged). Reuses the single `PostingEngine`, tenant-tx/RLS
model, `@erp/domain` money + effective-dated rule lookup, accounting periods, and the GL.

## Why this slice
First operational vertical of Phase 2. It establishes the **shared machinery** that all later
operational modules (MM, Cash/Bank, POS) reuse — a customer/business-partner master, a
**document → GL posting framework** (operational documents post through the existing single
posting engine; no direct GL writes), an **AR sub-ledger** (resolves the Phase-1 131 dual-nature
limitation), **output VAT** via the effective-dated rules, and the **e-invoice domain + provider
interface** — while delivering a usable revenue cycle: issue a sales invoice → it posts to the GL
and AR → receive customer payment → AR settles.

## Confirmed decisions
- **Scope:** billing-centric — **sales invoice → AR → customer receipt**. No sales order /
  delivery / goods-issue / COGS (those need the inventory engine; deferred to Phase 2b).
- **E-invoicing:** model the e-invoice **domain + provider interface with a stub** (no live
  provider transmission) now.
- VND-only (consistent with Phase 1).

## Non-negotiable principles (carried forward)
- Operational documents are **document engines**: every financial effect posts to the GL through
  the **one `PostingEngine`** (draft→posted, append-only, balanced). No module writes journal rows
  directly.
- Money is `bigint` minor units; VAT via `applyRate(amount, num, den, HALF_UP)` — never float.
- Every tax rule cites its source regulation in code + `compliance-map.md`.
- New tables are company-scoped **RLS (FORCE)**, proven by tests.

---

## 1. Data model additions (company-scoped, RLS FORCED)

- **`business_partners`** — customer/vendor master: `id, companyId, code, name, taxCode (MST),
  partnerType ('customer'|'vendor'|'both'), address, email, phone, isActive`. UNIQUE
  `(companyId, code)`. (Phase 2a uses the `customer` role; `vendor` reserved for 2b.)
- **`sales_invoices`** (header): `id, companyId, partnerId FK business_partners, invoiceNo
  (sequential per company+fiscalYear), invoiceDate, periodId FK accounting_periods, description,
  status ('draft'|'posted'|'cancelled'), journalEntryId (nullable FK journal_entries — set on
  post), subtotalMinor bigint, vatMinor bigint, totalMinor bigint, createdBy, postedAt, createdAt`.
- **`sales_invoice_lines`**: `id, invoiceId FK cascade, companyId, lineNo, description, quantity
  (numeric), unitPriceMinor bigint, lineNetMinor bigint, vatRuleType ('vat_rate'|'vat_rate_reduced'
  |'vat_rate_5'|'vat_zero'|'vat_exempt'), vatRatePct (the resolved rate, for audit), vatMinor
  bigint, revenueAccountCode (default '511')`.
- **AR sub-ledger:** add a nullable **`partnerId`** column to `journal_lines` (FK
  business_partners) — so receivable (131) and, later, payable (331) lines carry the
  counterparty. The AR sub-ledger / aging is then `journal_lines` on the AR control account
  grouped by `partnerId`. (This is the clean resolution of the Phase-1 131 dual-nature limitation:
  the control-account balance is decomposed per partner.) The `PostingEngine.post` input gains an
  optional `partnerId` per line.
- **`customer_receipts`** (header): `id, companyId, partnerId, receiptNo, receiptDate, periodId,
  amountMinor bigint, settlementAccountCode ('111' cash | '112' bank), description, status
  ('draft'|'posted'|'cancelled'), journalEntryId, createdBy, postedAt`. Phase 2a: on-account
  settlement (reduces the customer's AR balance); explicit invoice-by-invoice allocation is a
  later refinement (note it).
- **`einvoices`** (e-invoice readiness — Decree 123/2020 + 70/2025 + Circular 78/2021 fields):
  `id, companyId, salesInvoiceId FK, mauSo (mẫu số / form code), kyHieu (ký hiệu / serial symbol),
  soHoaDon (số / number, assigned on issue), sellerMst, buyerMst, buyerName, buyerAddress,
  currency, subtotalMinor, vatMinor, totalMinor, status ('pending'|'issued'|'failed'|'cancelled'),
  providerCode (returned by provider on issue), providerName, gdtMessageId (nullable), issuedAt,
  payload jsonb (the GDT-shaped document)`. Cite the decrees/circular.

## 2. Document → GL posting framework

A small reusable contract: an operational document service builds a **balanced set of journal
lines** (using `@erp/domain` invariants) and calls `PostingEngine.post(...)` inside the request
tenant tx, honoring the draft→posted sequence; it stores the returned `journalEntryId` on the
document. Cancellation posts a **reversal** and flips the document to `cancelled`. This keeps the
GL the single source of truth and every operational effect auditable.

## 3. Sales invoice posting (output VAT)

On **post** of a sales invoice (an open period):
- For each line: `lineNet = applyRate?`… the line net is `quantity × unitPrice` (integer-exact;
  quantity is whole or scaled — Phase 2a uses integer quantities × bigint unit price). `vat =
  applyRate(lineNet, rateNumerator, rateDenominator, HALF_UP)` where the rate is resolved from
  `tax_rules` effective on `invoiceDate` for the line's `vatRuleType` (e.g. 10% standard, **8%
  reduced through 2026-12-31 — Resolution 204/2025/QH15**, 5%, 0%, exempt). Cite the rule at the
  call site.
- The journal entry (via `PostingEngine`):
  - **Dr 131** (Phải thu khách hàng) `total` — with `partnerId = customer` (AR sub-ledger).
  - **Cr 511** (Doanh thu) `Σ lineNet`.
  - **Cr 3331** (Thuế GTGT đầu ra) `Σ vat`.
  - (Exempt/zero lines contribute 0 VAT; if all exempt, no 3331 line.)
- Invoice `journalEntryId`, `subtotal/vat/total` stored. The DB double-entry trigger is the backstop.

## 4. Customer receipt posting

On **post** of a receipt: **Dr 111/112** (settlement account) `amount` / **Cr 131** `amount` with
`partnerId = customer`. Reduces the customer's AR balance (the AR sub-ledger nets to the open
receivable). Phase 2a settles on-account (FIFO/explicit allocation deferred — noted).

## 5. AR sub-ledger / aging (read-only)

- **AR by customer**: the open receivable per partner = net of `journal_lines` on the AR control
  account (131) grouped by `partnerId`, through a chosen period. Includes invoices (Dr) and
  receipts (Cr).
- **AR aging** (Phase 2a: simple) — open balance per customer; bucketed aging (0–30/31–60/…) is a
  refinement (note it; Phase 2a can show current open balance + invoice list).

## 6. E-invoice domain + provider interface (stub)

- An `EInvoiceProvider` interface: `issue(einvoice): Promise<{ providerCode; soHoaDon; status;
  gdtMessageId? }>` and `cancel(providerCode): Promise<...>`. A **`StubEInvoiceProvider`** returns
  a generated code + sequential number (no network), so the flow is exercised end-to-end without a
  live provider (Viettel/VNPT/MISA chosen later — open question).
- Issuing a **posted** sales invoice creates an `einvoices` row (status pending), builds the
  GDT-shaped payload (seller/buyer MST, line items, tax breakdown per Decree 123/70 + Circular 78),
  calls `provider.issue` → status `issued` with the provider code/number. The e-invoice is **not**
  a GL event (the GL effect is the invoice posting); it models statutory issuance readiness.

## 7. Read-only UI (Vietnamese)
- **Customers** list (+ create form). **Sales invoices** list (status, customer, total) + a simple
  create form (customer, lines: description/qty/price/VAT rate) that posts via the API. **AR by
  customer** (open balance + the customer's invoices/receipts). All money via the exact VND
  formatter; no business logic in web.

## 8. Tests (full coverage)
- Output VAT: a line at 10% and a line at 8% (reduced, dated in 2026) compute the exact VAT
  (HALF_UP); an exempt line → 0 VAT, no 3331 line; the posted entry balances (Dr 131 = Cr 511 + Cr
  3331); `vatRatePct` recorded.
- AR sub-ledger: after invoice + partial receipt, the customer's AR balance = invoice total −
  receipt; two customers' balances are independent (partnerId scoping).
- Posting framework: cancelling an invoice posts a balanced reversal and the AR returns to prior.
- E-invoice stub: issuing a posted invoice yields an `issued` e-invoice with a provider code +
  number; the payload carries seller/buyer MST + tax breakdown.
- RLS: business_partners/sales_invoices/sales_invoice_lines/customer_receipts/einvoices are
  company-scoped — an accountant granted only Company A cannot read/create Company B's customers
  or invoices (extends the isolation e2e). Posting still goes through the engine's access checks.
- Effective-dated VAT: an invoice dated 2027-01-02 does NOT get the 8% reduced rate (window closed).

## 9. Demo seed
Extend the seed: a couple of customers for the SME, one posted sales invoice (with 10% + 8% lines)
→ AR balance shows; one partial receipt; an issued e-invoice (stub). So the AR and invoice screens
render real data.

---

## Out of scope for Phase 2a (later)
Sales order / quotation / delivery / goods-issue / COGS / inventory (Phase 2b MM); AP/vendor side
(2b); cash book / bank reconciliation (2c); fixed assets (2d); live e-invoice provider integration
+ GDT XML transmission + signing; multi-currency; invoice-level receipt allocation + aging buckets;
credit limits. Phase 2a delivers a posting-correct, AR-tracked, e-invoice-ready billing cycle.

## Compliance sources to cite
- VAT: Law on VAT 48/2024/QH15 + Decree 181/2025/ND-CP; **Resolution 204/2025/QH15** (8% reduced
  through 2026-12-31); output VAT account 3331 (Circular 133).
- AR: account 131 (Circular 133).
- E-invoicing: Decree 123/2020/ND-CP + Circular 78/2021/TT-BTC + Decree 70/2025/ND-CP; GDT
  e-invoice XML standard (Quyết định 1450/QĐ-TCT).

## Open questions for the user
1. **First e-invoice provider** to shape the stub/interface after (Viettel / VNPT / MISA)? (Not
   blocking — the stub is provider-agnostic; affects field mapping when a live provider lands.)
2. **Invoice numbering**: per-company sequential `invoiceNo` per fiscal year (assumed, like
   journal `entryNo`) — OK? (The statutory e-invoice `số`/`ký hiệu` is separate, assigned at issue.)
