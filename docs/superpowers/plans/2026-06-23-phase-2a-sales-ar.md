# Phase 2a — Sales Billing → AR → Receipts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A posting-correct, AR-tracked, e-invoice-ready sales-billing cycle on the Phase 1 accounting core: customer master, a document→GL posting framework, sales invoices (output VAT via effective-dated rules) posting Dr 131 / Cr 511 / Cr 3331, an AR sub-ledger by customer (resolving the 131 dual-nature limitation), customer receipts settling AR, and a selectable e-invoice provider (Viettel/VNPT/MISA stubs) — with read-only Vietnamese UI and full tests.

**Architecture:** Operational documents are document engines that build balanced journal lines and post through the existing single `PostingEngine` (extended with an optional per-line `partnerId`); the GL stays the single source of truth. New tables are company-scoped RLS (FORCE). Money is `bigint`; VAT via `applyRate(…HALF_UP)` over the effective-dated `tax_rules`.

**Spec:** `docs/superpowers/specs/2026-06-23-phase-2a-sales-ar-design.md`

**Standing rules (CLAUDE.md):** one posting engine writes the GL; documents never write journals directly; money is bigint (no float); cite every tax rule in code + `compliance-map.md`; request-path queries use `currentTx().db`; new financial tables are company-scoped RLS (FORCE); tests run as a NOBYPASSRLS role; no business logic in web; ESM `.js` extensions; `.test.ts` excluded from package builds.

**Test DB note (DB-backed tasks):** throwaway PG + NOBYPASSRLS `erp` role owning the db; `pnpm --filter @erp/db migrate`; tests gated on `TEST_DATABASE_URL`; clean up the container.

---

## Task A1: `@erp/domain` — sales line + VAT helpers (TDD)
**Files:** `packages/domain/src/sales.ts` + `sales.test.ts`; barrel export.
- `lineNet(quantity: bigint, unitPriceMinor: bigint): bigint` = `quantity * unitPriceMinor` (integer-exact).
- Reuse `applyRate` for VAT. Add `VAT_RULE_TYPES` constant and a `vatFor(net: bigint, ratePct: bigint): bigint` = `applyRate(money(net,'VND'), ratePct, 100n, HALF_UP).minor` convenience (ratePct as a whole-number percent; 8 → 8%, 0 → 0). Document that the effective rate is resolved from `tax_rules` by the API, not here.
- Tests: lineNet(3n, 100_000n)=300_000n; vatFor(1_000_000n,10n)=100_000n; vatFor(1_005n,10n)=101n (HALF_UP); vatFor(net,0n)=0n. Pure, bigint only.
- [ ] tests→fail→implement→pass; build/typecheck; commit `feat(domain): sales line net + VAT helpers`.

## Task A2: `@erp/db` — sales/AR schema + RLS + VAT rule rows
**Files:** `src/schema/sales.ts` (business_partners, sales_invoices, sales_invoice_lines, customer_receipts), `src/schema/einvoices.ts`, add `partnerId` to `journal_lines` in `src/schema/journals.ts`, enums in `enums.ts`, export in `index.ts`; append RLS to `src/rls.sql`; generate migration.
- Tables per the spec §1 (company-scoped; bigint money; UNIQUE (companyId, code) for partners; invoiceNo/receiptNo unique per (companyId, fiscalYear)). `journal_lines.partnerId uuid` nullable FK business_partners.
- enums: `partnerType ('customer'|'vendor'|'both')`, `salesDocStatus ('draft'|'posted'|'cancelled')`, `einvoiceStatus ('pending'|'issued'|'failed'|'cancelled')`, `einvoiceProvider ('viettel'|'vnpt'|'misa')`.
- `rls.sql` (re-runnable, DROP POLICY IF EXISTS): ENABLE+FORCE + USING/WITH CHECK `app_is_admin() OR company_id = ANY(app_accessible_companies())` on business_partners, sales_invoices, sales_invoice_lines, customer_receipts, einvoices (mirror the Phase-1 company policy). (`journal_lines` already has RLS; partnerId rides along.) Add indexes: `sales_invoices(company_id, partner_id)`, `journal_lines(company_id, account_id, partner_id)` (extend/replace the existing one if helpful), `einvoices(sales_invoice_id)`.
- VAT rule rows: add to the seed/migration `tax_rules` for `vat_rate_5` (5), `vat_zero` (0), `vat_exempt` (0) effective open-ended, plus ensure `vat_rate` (10) and `vat_rate_reduced` (8, effectiveTo 2027-01-01) exist (Phase 0 seeded them — verify; the seed is the source of truth). Cite Law on VAT 48/2024/QH15 + Resolution 204/2025/QH15.
- [ ] generate migration (incremental, e.g. 0002); build/typecheck; migrate on real PG; **live RLS proof** (admin insert ok; non-admin scoped to A cannot see B's partners/invoices; empty context→0; idempotent re-migrate). Commit `feat(db): sales/AR + einvoice schema, partnerId on journal_lines, company-scoped RLS`.

## Task A3: API — PostingEngine `partnerId` + document-posting helper
**Files:** extend `apps/api/src/accounting/posting-engine.service.ts`; add `src/documents/document-posting.ts` (a thin helper or documented pattern).
- `PostInput` line gains optional `partnerId`; `post()` writes it onto the `journal_lines` row. Reversal carries partnerId through `buildReversal` analog (swap debit/credit, keep accountId + partnerId).
- Document-posting contract: a helper `postDocument(ctx, { lines, periodId, entryDate, description })` that calls the engine and returns the `journalEntryId`; and `reverseDocument(journalEntryId, …)` for cancellation. Keep it minimal (services may call the engine directly) — the value is a single tested place for the partner-aware post+reverse.
- [ ] Tests: posting an entry with partnerId persists it on the AR line; reversal preserves partnerId. Build/typecheck. Commit `feat(api): posting engine partner dimension + document-posting helper`.

## Task A4: API — customer (business partner) master
**Files:** `apps/api/src/sales/partners.service.ts` + controller + module (`SalesModule`), wire into app.module.
- CRUD-lite: `POST /companies/:id/partners` (AdminGuard or AuthGuard — choose AuthGuard so accountants can manage their company's customers), `GET /companies/:id/partners`, `GET /partners/:id`. Zod DTOs. Company-scoped via `currentTx().db`. Code unique per company.
- [ ] Tests (DB-backed): create a customer, list, get; cross-company isolation (extended later in A9). Build/typecheck. Commit `feat(api): customer/business-partner master`.

## Task A5: API — sales invoice (output VAT, post via engine)
**Files:** `apps/api/src/sales/sales-invoice.service.ts` + controller; tests `apps/api/test/sales-invoice.int.test.ts`.
- `create(draft)` then `post(invoiceId)` (or a single post endpoint): for each line resolve the VAT rate from `tax_rules` effective on `invoiceDate` for the line `vatRuleType` (via `findEffectiveRule` over a DB query of tax_rules); `lineNet = lineNet(qty, unitPrice)`; `vat = vatFor(lineNet, ratePct)`; store `vatRatePct`, `vatMinor`, `lineNetMinor`. Build journal lines: Dr 131 total (partnerId=customer), Cr 511 ΣlineNet, Cr 3331 Σvat (omit 3331 if Σvat=0); post via the engine (draft→posted) into the invoice's open period; store `journalEntryId`, subtotal/vat/total; set invoice `status='posted'`. `cancel(invoiceId)` → reverse the journal entry, set `status='cancelled'`. Cite the VAT regulation at the rate-resolution call site.
- Endpoints: `POST /companies/:id/sales-invoices` (create+post), `GET /sales-invoices/:id`, `POST /sales-invoices/:id/cancel`. AuthGuard + engine access checks.
- [ ] Tests: invoice with a 10% line + an 8% line (dated 2026) → exact VAT (HALF_UP), balanced entry (Dr131=Cr511+Cr3331), correct subtotal/vat/total; an exempt line → 0 VAT, no 3331 line; an invoice dated 2027-01-02 does NOT get 8% (window closed → falls back to standard or errors per design — assert the resolved rate); cancel posts a balanced reversal. Build/typecheck. Commit `feat(api): sales invoice posting with effective-dated output VAT`.

## Task A6: API — customer receipts
**Files:** `apps/api/src/sales/receipts.service.ts` + controller; tests.
- `post({ companyId, partnerId, periodId, receiptDate, amount, settlementAccountCode })`: journal Dr 111/112 amount / Cr 131 amount (partnerId); via engine; store journalEntryId; status posted. `cancel` → reverse.
- Endpoints: `POST /companies/:id/customer-receipts`, `GET /customer-receipts/:id`, `POST /customer-receipts/:id/cancel`. AuthGuard.
- [ ] Tests: receipt reduces the customer's AR (verified against the AR read in A7 or a direct 131-by-partner query); cancel restores. Build/typecheck. Commit `feat(api): customer receipts settling AR`.

## Task A7: API — AR sub-ledger / aging (read-only)
**Files:** `apps/api/src/sales/ar.service.ts` + add endpoints to a reports/sales controller; tests.
- `arByCustomer(companyId, fiscalYear, throughPeriodNo)`: aggregate non-draft `journal_lines` on the AR control account (131) grouped by `partnerId` → `{ partnerId, partnerName, debit, credit, balance }` (bigint), only partners with activity. `arForCustomer(companyId, partnerId, …)`: that customer's invoices + receipts (open items list) and balance.
- Endpoints: `GET /companies/:id/ar?fiscalYear=&through=`, `GET /companies/:id/ar/:partnerId?...`. AuthGuard.
- [ ] Tests: after invoice (total T) + partial receipt (R), the customer's AR balance = T − R; two customers independent; the AR control total reconciles to the 131 trial-balance line. Build/typecheck. Commit `feat(api): AR sub-ledger + aging by customer`.

## Task A8: API — e-invoice domain + selectable provider (Viettel/VNPT/MISA stubs)
**Files:** `apps/api/src/einvoice/einvoice.types.ts`, `provider.interface.ts`, `providers/{viettel,vnpt,misa}.stub.ts`, `provider.registry.ts`, `einvoice.service.ts` + controller; tests.
- `EInvoiceProvider` interface: `id`, `issue(doc): Promise<{ providerCode; soHoaDon; status; gdtMessageId? }>`, `cancel(providerCode)`. Three **stub** impls (viettel/vnpt/misa) returning a generated `providerCode` + a sequential `soHoaDon` (no network), differing only by a provider tag/prefix. A **registry** maps `einvoiceProvider` enum → impl; the active provider is chosen by config (a field on company/owner, default 'viettel'; selectable).
- `einvoice.service.issueForInvoice(salesInvoiceId)`: requires the sales invoice `posted`; builds the GDT-shaped payload (mẫu số, ký hiệu, seller/buyer MST, line items, tax breakdown per Decree 123/70 + Circular 78); creates `einvoices` row (pending) → calls the company's provider `issue` → status `issued` with code/number/payload. `cancel`. Cite the decrees/circular.
- Endpoints: `POST /sales-invoices/:id/einvoice:issue`, `GET /einvoices/:id`, `POST /einvoices/:id/cancel`. AuthGuard.
- [ ] Tests: issuing a posted invoice yields an `issued` e-invoice with provider code + soHoaDon + a payload carrying seller/buyer MST and the tax breakdown; switching the company's provider yields a different provider tag; issuing for a non-posted invoice → 422. Build/typecheck. Commit `feat(api): e-invoice domain + selectable provider registry (Viettel/VNPT/MISA stubs)`.

## Task A9: API — access isolation extended to sales/AR/einvoice (e2e)
**Files:** extend `helpers/make-app.ts` truncateAll (new tables); new `apps/api/test/sales-isolation.e2e.test.ts`.
- Prove an accountant granted only the SME cannot read/create the household company's partners, sales invoices, receipts, AR, or e-invoices (404/empty/403); unauth 401; admin sees both. Run the full api suite TWICE (repeatability; single-fork config already in place).
- [ ] Commit `test(api): access isolation extended to sales/AR/e-invoice`.

## Task A10: Web — customers / sales invoices / AR (read-only + create)
**Files:** `apps/web/src/app/[locale]/companies/[id]/sales/*` pages; i18n keys (vi+en parity); `lib/api.ts`.
- Customers list + create; sales invoices list (status/customer/total) + a create form (customer + lines: description/qty/unitPrice/VAT-rule-type) that POSTs and shows the posted result; AR-by-customer view (open balance + the customer's documents). Use the cookie-forwarding server-component fetch; VND via the exact formatter; provider/VAT labels via i18n. No business logic in web.
- [ ] i18n parity test green; web build + lint; a Playwright smoke asserting the sales/AR route headings render (graceful empty-state without backend). Commit `feat(web): customers, sales invoices, AR views`.

## Task A11: Demo seed + docs + final pipeline
**Files:** extend `packages/db/src/seed.ts`; update `compliance-map.md`, `MODULE_ROADMAP.md`, `ARCHITECTURE.md`, `docs/open-questions.md`.
- Seed: 2 customers for the SME; one posted sales invoice (a 10% line + an 8% line) → AR balance; one partial receipt; one issued e-invoice (stub). Idempotency preserved.
- Docs: compliance-map rows (output VAT 3331 → Law on VAT 48/2024 + Resolution 204/2025; AR 131; e-invoicing → Decree 123/2020 + 70/2025 + Circular 78); MODULE_ROADMAP Phase 2a → done; ARCHITECTURE sales/AR + document-posting + e-invoice section; note the AR sub-ledger resolves the 131 limitation.
- Final pipeline (paste): install/lint/typecheck/build/migrate/seed/test all green as a NOBYPASSRLS role.
- [ ] Commit `feat: phase 2a demo seed + docs`.

---

## Definition of Done (Phase 2a)
- Full pipeline green as a NOBYPASSRLS role.
- Sales invoices post correct output VAT (effective-dated 10%/8%/5%/0/exempt, HALF_UP) Dr 131/Cr 511/Cr 3331 through the single engine; AR tracked per customer (partnerId) — the 131 dual-nature limitation resolved; receipts settle AR; cancellation reverses.
- E-invoice domain modeled (Decree 123/70 + Circular 78 fields) with a **selectable** provider registry (Viettel/VNPT/MISA stubs); issuing a posted invoice produces an issued e-invoice.
- Access isolation extended to all new tables and proven; read-only Vietnamese UI renders customers/invoices/AR; demo seed shows real data.
- **STOP after Phase 2a and present for review before Phase 2b (MM).**
