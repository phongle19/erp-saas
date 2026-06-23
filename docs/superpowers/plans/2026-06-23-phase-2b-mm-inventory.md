# Phase 2b — MM: Procure-to-Pay + Inventory + AP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Procurement cycle + weighted-average inventory + AP on the existing accounting/sales core: material master, purchase invoices (goods receipt + input VAT + AP), goods issue (COGS at weighted-avg), AP sub-ledger by vendor (resolving the 331 limitation), vendor payments, read-only Vietnamese UI, full tests — all posting through the single engine.

**Architecture:** New documents post via `DocumentPostingService` → the single `PostingEngine`. Inventory value is tracked integer-exact (`balanceQty`/`balanceValue` bigint) in `inventory_movements`; weighted-average issue cost via a pure `@erp/domain` helper. Vendors reuse `business_partners`; AP rides on `journal_lines.partner_id` / TK 331. New tables company-scoped RLS (FORCE). VND-only.

**Spec:** `docs/superpowers/specs/2026-06-23-phase-2b-mm-inventory-design.md`

**Standing rules (CLAUDE.md):** one posting engine writes the GL; documents never write journals directly; money/inventory value is bigint (no float); cite tax rules in code + compliance-map; request-path queries use `currentTx().db`; new financial tables company-scoped RLS (FORCE); tests run as a NOBYPASSRLS role (the api suite is single-fork serial — keep it); no business logic in web; ESM `.js` extensions; `.test.ts` excluded from package builds; controllers serialize bigint→string before returning (audit interceptor).

**Test DB note:** throwaway PG + NOBYPASSRLS `erp` role owning db; `pnpm --filter @erp/db migrate`; tests gated on `TEST_DATABASE_URL`; clean up the container.

---

## Task B1: `@erp/domain` — weighted-average inventory helpers (TDD)
**Files:** `packages/domain/src/inventory.ts` + `inventory.test.ts`; barrel export.
- `receiptBalance(prevQty: bigint, prevValue: bigint, q: bigint, cost: bigint): { qty: bigint; value: bigint }` = `{ prevQty+q, prevValue+cost }` (q>0, cost>=0 else throw).
- `issueCost(prevQty: bigint, prevValue: bigint, q: bigint): { costOut: bigint; qty: bigint; value: bigint }`: throw if `q <= 0` or `q > prevQty`; `costOut = applyRate(money(prevValue,'VND'), q, prevQty, HALF_UP).minor` (capped at prevValue — when q==prevQty, costOut := prevValue exactly so value clears to 0); `qty = prevQty - q`, `value = prevValue - costOut`. Integer-exact, no float.
- Tests: receipt 10 @ 1,000,000 then receipt 10 @ 1,200,000 → qty 20, value 22,000,000 (avg 1,100,000); issue 5 → costOut 5,500,000, remaining qty 15 value 16,500,000; issue ALL remaining → value exactly 0 (residual cleared); over-issue (q>prevQty) → throws; a non-divisible case (value 10, qty 3, issue 1 → costOut HALF_UP = round(10/3)=3, value 7) — assert integer-exactness.
- [ ] tests→fail→implement→pass; build/typecheck; commit `feat(domain): weighted-average inventory helpers`.

## Task B2: `@erp/db` — MM schema + RLS + migration
**Files:** `src/schema/inventory.ts` (materials, inventory_movements), `src/schema/purchasing.ts` (purchase_invoices, purchase_invoice_lines, goods_issues, goods_issue_lines, vendor_payments); enums (`movementType ('receipt'|'issue')`, `mmDocStatus` reuse `salesDocStatus`? — reuse the existing `sales_doc_status` enum values draft/posted/cancelled by adding a generic `docStatus`; SIMPLEST: reuse `salesDocStatus` for these too, or add `mm_doc_status` identical — decide: reuse `salesDocStatus`). Export in index.ts; append RLS to `rls.sql`; generate incremental migration.
- All tables company-scoped with bigint money/qty; uniques per the spec §2; FKs (materialId→materials, partnerId→business_partners, periodId→accounting_periods, companyId→companies); `inventory_movements` indexed `(company_id, material_id, created_at)`.
- `rls.sql` (re-runnable): ENABLE+FORCE + USING/WITH CHECK `app_is_admin() OR company_id = ANY(app_accessible_companies())` for all new tables; indexes.
- [ ] generate (incremental, e.g. 0005); build/typecheck; migrate on real PG; **live RLS proof** (admin insert; non-admin scoped to A can't see B's materials/purchases/movements; empty→0; idempotent). Commit `feat(db): MM (inventory + purchasing) schema + company-scoped RLS`.

## Task B3: API — inventory valuation service (weighted average)
**Files:** `apps/api/src/inventory/inventory.service.ts` + a read controller; tests.
- `applyReceipt(ctx, { materialId, quantity, cost, sourceDocType, sourceDocId, journalEntryId, periodId, movementDate })`: load the material's current balance (latest `inventory_movements` row, or 0/0); compute `receiptBalance`; insert a movement (type 'receipt', balanceQtyAfter/balanceValueAfter, unitCost = cost/qty derived). Returns the new balance. (Called by the purchase-invoice service inside its tx.)
- `applyIssue(ctx, { materialId, quantity, ... })`: load current balance; `issueCost` (422 if over-issue); insert an 'issue' movement; return `{ costOut }`. (Called by the goods-issue service.)
- `onHand(companyId, materialId)` and `valuationReport(companyId, asOf?)`: latest balance per material → `{ materialCode, name, qty, value, avgUnitCost }`; total value (reconciles to GL 156). Read endpoints `GET /companies/:id/inventory` and `GET /companies/:id/inventory/:materialId/movements`.
- [ ] Tests: receipt then receipt → moving average; issue at weighted-avg; over-issue 422; valuation total. RLS-scoped (`currentTx().db`). Commit `feat(api): weighted-average inventory valuation`.

## Task B4: API — material master + vendor convenience
**Files:** `apps/api/src/inventory/materials.service.ts` + controller (in an MmModule); reuse `PartnersService` for vendors (partnerType 'vendor').
- Materials CRUD-lite: `POST/GET /companies/:id/materials`, `GET /materials/:id` (AuthGuard; 409 dup code; 403 cross-company; trimmed Zod). (Vendors: the existing partners endpoints already cover creation with partnerType 'vendor' — no new endpoint needed; note it.)
- [ ] Tests: create/list/get material; dup 409; cross-company 403/empty. Commit `feat(api): material master`.

## Task B5: API — purchase invoice (goods receipt + input VAT + AP)
**Files:** `apps/api/src/purchasing/purchase-invoice.service.ts` + controller; tests.
- `createAndPost(companyId, input)` (input: partnerId vendor, invoiceDate, periodId, vendorInvoiceNo?, nonCashPayment?, description?, lines:[{materialId, quantity, unitCostMinor, vatRuleType}]):
  - access 403; vendor partner belongs to company (422); period open+company (422), fiscalYear.
  - per line: `lineCost = quantity × unitCostMinor`; resolve input VAT rate effective on invoiceDate for `vatRuleType` (same `findEffectiveRule` over tax_rules; 422 if not effective); `vat = vatFor(lineCost, ratePct)`; resolve the material → its inventoryAccountCode.
  - totals: subtotal Σ lineCost, vatTotal Σ vat, total subtotal+vatTotal.
  - **post via engine**: Dr inventory account(s) (group by inventoryAccountCode) Σ lineCost, Dr 1331 vatTotal (omit if 0), Cr 331 total (partner_id=vendor). Cite Law on VAT 48/2024/QH15 (+ ≥5M non-cash note) at the VAT site.
  - **inventory**: for each line call `inventory.applyReceipt(...)` (movement + moving average) with the journalEntryId.
  - persist purchase_invoices (invoiceNo MAX+1 per company/fy, status posted, totals, journalEntryId) + lines; one tx (atomic). `cancel` → reverse journal + reverse inventory movements (compensating). `get` RLS-scoped.
  - Endpoints (AuthGuard, serialize bigint): `POST /companies/:id/purchase-invoices`, `GET /purchase-invoices/:id`, `POST /purchase-invoices/:id/cancel`.
- [ ] Tests: 2-line purchase (10% + 8% input VAT) → Dr 156 Σcost, Dr 1331 Σvat, Cr 331 total balanced; inventory movements created + on-hand value increased by Σcost; AP (331 by vendor) increased by total; effective-dating 422; cancel reverses GL + inventory (on-hand back). Commit `feat(api): purchase invoice (goods receipt + input VAT + AP)`.

## Task B6: API — goods issue (COGS at weighted-average)
**Files:** `apps/api/src/purchasing/goods-issue.service.ts` + controller; tests.
- `createAndPost(companyId, input)` (issueDate, periodId, reason, lines:[{materialId, quantity}]): per line `inventory.applyIssue(...)` → costOut (422 if over-issue); post via engine Dr 632 ΣcostOut / Cr inventory account(s) ΣcostOut; persist goods_issues + lines (issueNo per company/fy); atomic. `cancel` reverses.
- Endpoints: `POST /companies/:id/goods-issues`, `GET /goods-issues/:id`, `POST /goods-issues/:id/cancel`.
- [ ] Tests: issue at the current weighted-avg cost → Dr 632 / Cr 156 balanced, inventory decreased; over-issue 422; COGS amount == weighted-avg × qty. Commit `feat(api): goods issue (COGS at weighted-average cost)`.

## Task B7: API — AP sub-ledger / aging + inventory valuation reconciliation
**Files:** `apps/api/src/purchasing/ap.service.ts` + endpoints; tests.
- `apByVendor(companyId, fy, through)`: `journal_lines` on account **331** grouped by partner_id (status<>'draft', cumulative through) → `{ partner, debit, credit, balance }` + total; reconciles to the TB 331 line. `apForVendor` = a vendor's open items. Endpoints `GET /companies/:id/ap`, `GET /companies/:id/ap/:partnerId`.
- [ ] Tests: after a purchase (AP=T) + a partial vendor payment (R), vendor AP balance = T − R; AP total reconciles to TB 331; inventory valuation total reconciles to TB 156. Commit `feat(api): AP sub-ledger by vendor (reconciles to TB 331)`.

## Task B8: API — vendor payments
**Files:** `apps/api/src/purchasing/vendor-payment.service.ts` + controller; tests.
- `createAndPost`: Dr 331 amount (partner_id=vendor) / Cr 111/112 amount; paymentNo per company/fy; `cancel` reverses. Endpoints `POST /companies/:id/vendor-payments`, `GET /vendor-payments/:id`, `POST /vendor-payments/:id/cancel`.
- [ ] Tests: payment reduces vendor AP (verified against AP read / 331 by partner); cancel restores. Commit `feat(api): vendor payments settling AP`.

## Task B9: API — access isolation extended to MM (e2e)
**Files:** extend `helpers/make-app.ts` truncateAll (new tables); `apps/api/test/mm-isolation.e2e.test.ts`.
- Accountant granted only the SME cannot read/create the household's materials, purchase invoices, inventory, AP, goods issues, vendor payments (404/empty/403); admin sees both; unauth 401. Run full api suite TWICE (repeatable). Commit `test(api): access isolation extended to MM`.

## Task B10: Web — materials / inventory / purchases / AP views
**Files:** `apps/web/src/app/[locale]/companies/[id]/purchasing/*` (or `/mm/*`); i18n keys (vi+en parity).
- Materials list + create; inventory valuation (on-hand qty/value/avg cost per material); purchase invoice create (vendor + lines: material/qty/unitCost/input-VAT) + posted result; AP-by-vendor; goods-issue create. Cookie-forwarding server fetch; VND via formatVnd; all text via i18n. No business logic / no @erp/db in web. Playwright smoke for the inventory + AP headings (graceful empty-state). Commit `feat(web): materials, inventory valuation, purchases, AP views`.

## Task B11: Demo seed + docs + final pipeline
**Files:** extend `packages/db/src/seed.ts`; update `compliance-map.md`, `MODULE_ROADMAP.md`, `ARCHITECTURE.md`, `docs/open-questions.md`.
- Seed (SME): 2 materials; a purchase invoice (receipt of stock + input VAT) → inventory value + AP; a goods issue (COGS); a partial vendor payment. Idempotency preserved. Verify the 156 and 331 reconciliations in the seed output.
- Docs: compliance-map (input VAT 1331 + ≥5M rule; inventory 152/156 + weighted-avg + VAS 02; COGS 632; AP 331); MODULE_ROADMAP Phase 2b → done (note 331 resolved via partner_id, COGS/inventory now live); ARCHITECTURE MM section (weighted-average engine, procure-to-pay posting, AP sub-ledger); open-questions update (331 resolved; PO/warehouse/FIFO deferred).
- Final pipeline (paste): install --frozen-lockfile / lint / typecheck / build / migrate / seed / test green as NOBYPASSRLS.
- [ ] Commit `feat: phase 2b demo seed + docs`.

---

## Definition of Done (Phase 2b)
- Full pipeline green as a NOBYPASSRLS role.
- Purchase invoices post Dr 156/152 + Dr 1331 / Cr 331 (vendor partner_id) through the single engine; input VAT effective-dated; **weighted-average inventory** updated and reconciling to the GL 156 line.
- Goods issue posts COGS (Dr 632 / Cr 156) at the weighted-average cost; over-issue rejected.
- AP tracked per vendor (partner_id / TK 331), reconciling to TB 331 — **the 331 dual-nature limitation resolved**; vendor payments settle AP; cancellations reverse GL + inventory.
- Access isolation extended to all MM tables and proven; read-only Vietnamese UI; demo seed renders inventory/AP with reconciliations holding.
- **Present for review before Phase 2c (Cash & Bank).**
