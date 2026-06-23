# Phase 2b — MM: Procure-to-Pay + Inventory (Weighted Average) + AP (Design)

**Date:** 2026-06-23
**Status:** Draft (proceeding straight to implement per user go-ahead; decisions defaulted + noted)
**Builds on:** Phase 2a (sales/AR) merged. Reuses the single `PostingEngine`, `DocumentPostingService`,
`business_partners` (vendor role), `journal_lines.partner_id` (AP sub-ledger), effective-dated
`tax_rules` (input VAT), tenant-tx/RLS, `@erp/domain` money.

## Scope (decided)
The procurement mirror of 2a, plus the genuinely new **weighted-average inventory engine** (which
also unblocks COGS): material master, purchase invoices (goods receipt + AP + input VAT), goods
issue (COGS at weighted-average cost), AP sub-ledger by vendor, vendor payments, read-only UI,
demo seed. **VND-only.** Purchase ORDER / quotation / approval workflow and warehouse/bin
management are deferred (a later refinement); Phase 2b is invoice/receipt-centric like 2a.

## Non-negotiable principles (carried forward)
- All financial effects post to the GL through the **one `PostingEngine`** (via `DocumentPostingService`);
  no module writes journals directly.
- Money is `bigint` minor units; **inventory value is tracked as integer-exact `bigint`** — never a
  stored fractional unit cost. VAT via `applyRate(…HALF_UP)`.
- Every tax/accounting rule cites its source regulation in code + `compliance-map.md`.
- New tables are company-scoped **RLS (FORCE)**, proven by tests.

---

## 1. Weighted-average (moving-average) inventory — the core model

Track, per `(company, material)`, a running **`balanceQty` (bigint)** and **`balanceValue` (bigint
minor units)**. The unit cost is **derived** (`balanceValue / balanceQty`), never stored as a
fraction — this keeps everything integer-exact and reconcilable to the GL.

- **Receipt** (qty `q` at total cost `c`): `balanceQty += q`, `balanceValue += c`. (Moving average
  rises/falls automatically.)
- **Issue** (qty `q`): cost out = `floor(balanceValue × q / balanceQty)` (integer division;
  document the rounding — HALF_UP via the same `applyRate` mechanism, but floor/round-down is the
  conservative inventory convention — **decision: round to nearest, HALF_UP, with the residual
  staying in `balanceValue`** so value never drifts negative and the last issue clears it). Then
  `balanceValue -= costOut`, `balanceQty -= q`. Guard: cannot issue more than `balanceQty`.
- Each movement is recorded in **`inventory_movements`** with `balanceQtyAfter` / `balanceValueAfter`
  so the ledger is auditable and the on-hand value at any point is exact.
- **Reconciliation:** Σ `balanceValueAfter` (latest per material) == the GL inventory account (156)
  balance — tested, exactly like AR↔131.

### `@erp/domain` helper (pure, TDD)
`receiptBalance(prevQty, prevValue, q, c) → { qty, value }`; `issueCost(prevQty, prevValue, q, rounding)
→ { costOut, qty, value }` (issueCost = `applyRate(value, q, prevQty, HALF_UP)` capped at prevValue;
throws if q > prevQty). Integer-exact, no float.

## 2. Data model additions (company-scoped, RLS FORCED)
- **`materials`** (inventory item master): `id, companyId, code, name, unit (đvt), inventoryAccountCode
  (default '156'; '152' for raw materials), isActive`. UNIQUE `(companyId, code)`.
- **`inventory_movements`** (stock ledger): `id, companyId, materialId, movementType ('receipt'|'issue'),
  quantity bigint, unitCostMinor bigint (cost/qty at this movement, derived, for display),
  totalCostMinor bigint, balanceQtyAfter bigint, balanceValueAfter bigint, sourceDocType, sourceDocId,
  journalEntryId, movementDate, periodId, createdAt`. Indexed `(companyId, materialId, createdAt)`.
- **`purchase_invoices`** (vendor bill + goods receipt): `id, companyId, partnerId (vendor), invoiceNo
  (per company+fy), vendorInvoiceNo (the supplier's number), invoiceDate, periodId, fiscalYear,
  description, nonCashPayment boolean (for the ≥5M input-VAT credit rule), status, journalEntryId,
  subtotalMinor, vatMinor, totalMinor, postedAt`. UNIQUE `(companyId, fiscalYear, invoiceNo)`.
- **`purchase_invoice_lines`**: `id, invoiceId, companyId, lineNo, materialId, quantity bigint,
  unitCostMinor bigint, lineCostMinor bigint, vatRuleType, vatRatePct, vatMinor, inventoryAccountCode`.
  UNIQUE `(invoiceId, lineNo)`.
- **`goods_issues`** (consumption / sale-of-goods COGS): `id, companyId, issueNo, issueDate, periodId,
  fiscalYear, reason ('sale'|'consumption'|'adjustment'), description, status, journalEntryId,
  totalCostMinor, postedAt`. UNIQUE `(companyId, fiscalYear, issueNo)`.
- **`goods_issue_lines`**: `id, issueId, companyId, lineNo, materialId, quantity bigint, costMinor
  bigint (weighted-avg cost out), cogsAccountCode (default '632')`.
- **`vendor_payments`**: `id, companyId, partnerId (vendor), paymentNo, paymentDate, periodId,
  fiscalYear, amountMinor bigint, settlementAccountCode ('111'|'112'), description, status,
  journalEntryId, postedAt`. UNIQUE `(companyId, fiscalYear, paymentNo)`.
- (Vendors reuse `business_partners` with `partnerType` 'vendor' or 'both'. AP rides on
  `journal_lines.partner_id` on the 331 control account — no new partner table.)

## 3. Posting (all through the engine)
- **Purchase invoice** post: **Dr inventory (156/152)** `Σ lineCost`, **Dr 1331** (Thuế GTGT đầu vào)
  `Σ vat`, **Cr 331** (Phải trả người bán) `total`, `partner_id = vendor`. Also creates a **receipt
  inventory movement** per line (qty, cost) updating the material's moving average. (Input VAT 1331;
  the ≥VND 5,000,000 non-cash payment requirement for input-VAT credit — Law on VAT 48/2024/QH15 —
  is recorded via `nonCashPayment`; full credit-eligibility enforcement is a tax-engine concern, noted.)
- **Goods issue** post: for each line, `issueCost` at the material's current weighted average →
  **Dr 632** (Giá vốn) / **Cr 156** (or material's inventory account) `Σ costOut`; creates an issue
  movement per line. (This is the COGS leg deferred from 2a.)
- **Vendor payment** post: **Dr 331** `amount` (partner_id=vendor) / **Cr 111/112** `amount`. Settles AP.
- Cancellation of any document reverses its journal entry (partner-aware) and reverses its inventory
  movements (a compensating movement) so stock + GL stay consistent.

## 4. AP sub-ledger / aging (read-only)
`apByVendor(companyId, fy, through)`: `journal_lines` on the AP control account **331** grouped by
`partner_id` → `{ partner, debit, credit, balance }`; total reconciles to the TB 331 line (**resolves
the 331 dual-nature limitation**, mirroring AR/131). `apForVendor` = a vendor's open items.

## 5. Inventory valuation report (read-only)
Per material: on-hand `balanceQty` + `balanceValue` (+ derived avg unit cost) as of a date/period;
the movement ledger; and the **total inventory value reconciles to the GL 156 balance** (tested).

## 6. Read-only UI (Vietnamese)
Materials list + create; inventory valuation (on-hand qty/value per material); purchase invoices
create (vendor + lines: material/qty/unitCost/inputVAT) + posted result; AP-by-vendor; goods-issue
create. Money via the exact VND formatter; no business logic in web; vi+en i18n parity.

## 7. Tests (full coverage)
- Domain weighted-average: receipt then receipt at a different cost → correct moving average; issue
  at weighted-avg cost (integer-exact, residual handling); cannot over-issue; reconciliation property.
- Purchase invoice: Dr 156 + Dr 1331 / Cr 331 balanced; input VAT effective-dated; inventory movement
  created + moving average updated; AP (331 by vendor) increases.
- Goods issue: COGS at the current weighted-avg; inventory decreases; over-issue rejected (422).
- AP sub-ledger reconciles to the TB 331 line; inventory valuation reconciles to the TB 156 line.
- Vendor payment settles AP; cancellation reverses GL + inventory movement.
- RLS: all MM tables company-scoped — accountant scoped to one company can't read/post another's
  materials/purchases/inventory/AP (extends the isolation e2e).
- Posting only through the engine (no direct journal writes).

## 8. Demo seed
For the SME: a couple of materials; a purchase invoice (receipt of stock with input VAT) → inventory
value + AP; a goods issue (COGS); a vendor payment (partial). So the inventory/AP/valuation screens
render real data and the 156/331 reconciliations hold.

---

## Out of scope for Phase 2b (later)
Purchase order / quotation / approval workflow; warehouse/bin/multi-location; FIFO/specific-ID
valuation (weighted-average only); landed costs; the full SD delivery→goods-issue wiring (2b ships a
standalone goods-issue doc); live e-invoice; tax-engine input-VAT credit enforcement; multi-currency.

## Compliance sources to cite
- Input VAT (TK 1331) + the ≥VND 5,000,000 non-cash payment rule for input-VAT credit — Law on VAT
  48/2024/QH15 + Decree 181/2025/ND-CP.
- Inventory accounts (TK 152/156), COGS (TK 632), AP (TK 331), weighted-average method — Circular
  133/2016/TT-BTC (and VAS 02 Inventories).

## Resolved decisions (defaulted; flag if you disagree)
1. **Weighted-average** valuation (per the project brief), integer-exact value tracking, HALF_UP on
   issue with residual retained in value.
2. **Vendors reuse `business_partners`** (vendor role); AP on `journal_lines.partner_id` / TK 331.
3. **Goods issue** included (unblocks COGS); full SD-delivery wiring deferred.
4. **Input-VAT credit** ≥5M non-cash rule recorded via a flag + cited; enforcement is a later tax phase.
