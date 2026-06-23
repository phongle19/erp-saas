# Open Questions

Unresolved regulatory and technical decisions that must be confirmed before the relevant modules are built.

1. **CIT rates & 2025 law** — Confirm current Corporate Income Tax rates and any structural changes introduced by the new 2025 CIT law (replacing Circular 78/2014 & 96/2015). Update `docs/regulations/README.md` and the CIT calculation module once verified.

2. **PIT exemption thresholds & family deductions (Dec-2025 amendment)** — The December 2025 amendment to PIT (Circular 111/2013) may revise personal exemption amounts and dependant deduction figures. Confirm exact values before implementing payroll/PIT features.

3. **2026 household declaration circular** — Resolution 68-NQ/TW and Law 198/2025/QH15 mandate a new simplified declaration regime for household businesses effective 2026, with implementation detail deferred to a forthcoming MoF/GDT circular (expected Q1–Q2 2026). Track and incorporate when published.

4. **E-invoice provider** — Select the first provider integration target: Viettel, VNPT, or MISA. Decision affects the e-invoice transmission API adapter implemented in Task 9 and the e-invoice provider plugin architecture.

---

## Phase-1 hardening notes (surfaced during Phase 0 review)

5. **Login timing side-channel** — `AuthService.login` returns 401 immediately when the
   user row is not found, without performing an Argon2 hash verification. This leaks
   whether an email address is registered via response timing. Fix: always call a dummy
   `argon2.verify` against a constant hash when no user is found, so the response time
   is indistinguishable.
   File: `apps/api/src/auth/auth.service.ts` → `login()`.

6. **`FIELD_ENCRYPTION_KEY` not validated at startup** — `fieldKey()` in
   `apps/api/src/auth/crypto.util.ts` validates the key length at call time (when the
   field encryption is first used), not at application bootstrap. A missing or malformed
   key will only surface at runtime on the first encrypt/decrypt call. Fix: call
   `fieldKey()` (or an equivalent startup check) during NestJS `onApplicationBootstrap`
   so a bad key fails fast before the server accepts requests.

7. **`company_access` and `audit_log` reads are not RLS-scoped at the DB level** —
   These tables have no PostgreSQL RLS policies. Access control relies entirely on the
   app-layer `AdminGuard`. Consider whether `audit_log` reads should be RLS-scoped to
   the actor's accessible companies, and whether `company_access` reads should be
   restricted to the current user's own rows (for non-admin users). Document the
   decision in `compliance-map.md` under audit integrity.

8. **`ownership_links` parent == child self-reference** — The `ownership_links` table
   has a UNIQUE constraint on `(parent_company_id, child_company_id)` but no CHECK
   preventing a company from being its own parent (`parent_company_id = child_company_id`).
   Add: `CHECK (parent_company_id <> child_company_id)`.
   File: `packages/db/src/schema/companies.ts` → `ownershipLinks` table definition;
   then generate a new Drizzle migration.

9. **Next.js 16 host-header validation and Docker Desktop macOS** — Next.js 16 validates
   the `Host` header and may return 404 for requests arriving via Docker Desktop's
   VirtioFS network stack with an unexpected host value (e.g. `curl localhost:3000` from
   the host machine). This does not affect production container-network routing
   (`api → web` via Docker network name) but may confuse local debugging. If encountered,
   investigate the `trustHostHeader` option in `next.config` or ensure the `Host` header
   matches the expected value. Do not enable `trustHostHeader` blindly in production
   without understanding the SSRF implications.

10. **VERIFY: Circular 133 & 88 charts of accounts and B01-DNN/B02-DNN statement templates** —
    The seeded chart of accounts for Circular 133/2016/TT-BTC (`packages/config-regimes/src/coa/circular-133.ts`)
    and Circular 88/2021/TT-BTC (`packages/config-regimes/src/coa/circular-88.ts`), and the
    B01-DNN/B02-DNN financial statement line templates (`packages/config-regimes/src/statements/circular-133.ts`)
    were authored from knowledge of the circulars but were **not verified line-by-line against the
    official published circular text**. Before production use, a qualified accountant or compliance
    reviewer must verify: (a) account codes and Vietnamese names against Circular 133/2016/TT-BTC
    Phụ lục 1 and Circular 88/2021/TT-BTC; (b) completeness of the account list; (c) B01-DNN and
    B02-DNN line codes, labels, and account prefix mappings against the official form templates in
    Circular 133/2016/TT-BTC Phụ lục 2. Do not treat the seeded data as authoritative until verified.

## Phase 1 known limitation — dual-nature control accounts in statement mapping (logged 2026-06-23)

The Circular 133 Balance Sheet (B01-DNN) maps GL control accounts **131** (phải thu khách hàng /
receivable) and **331** (phải trả người bán / supplier payable) to BOTH an asset line and a
liability line, because each can legitimately carry a debit OR credit balance across different
counterparties. The Phase 1 statement engine evaluates the **aggregate** account balance, so a
single net balance is presented on one side correctly and mis-signed on the opposite line; the
account **333** can likewise show a negative-liability on a net-debit (refund) balance.

**Why:** faithful presentation requires per-counterparty sub-ledger (chi tiết công nợ) debit/credit
netting, which is deferred. It is NOT an engine arithmetic bug — prefix-sum, nature sign, `_neg`
subtraction, and the post-closing balance-sheet identity are all correct.

**Phase 2a update (2026-06-23) — TK 131 partially resolved:** `journal_lines.partner_id` now tags
every AR line with its customer. `ArService` aggregates per-customer debit/credit independently,
so per-customer receivable balances are correct even when some customers are in credit (overpayment).
The B01 aggregate-131 mapping limitation remains for the statement engine, but the AR sub-ledger
(`GET /companies/:id/ar`) provides faithful per-counterparty representation.

**Phase 2b update (2026-06-23) — TK 331 resolved:** `journal_lines.partner_id` now tags every AP
line with its vendor. `ApService` aggregates per-vendor debit/credit independently, resolving the
331 dual-nature limitation in the same way Phase 2a resolved TK 131. The B01 aggregate-331 mapping
limitation remains for the statement engine, but the AP sub-ledger (`GET /companies/:id/ap`) provides
faithful per-vendor representation.

## Phase 2a known limitation — whole-unit sales quantities (logged 2026-06-23)

`sales_invoice_lines.quantity` is a `bigint` (whole units) in Phase 2a. Fractional quantities
(e.g. 0.5 kg of goods, 2.5 consulting hours) are not yet supported. To resolve later: store a
scaled-integer quantity (with an explicit scale) so line net stays bigint-exact, and round the
extended amount with an explicit rule — never use float for the quantity × price product.

## Phase 2b known limitations (logged 2026-06-23)

1. **PO/quotation/approval workflow not implemented** — the procure-to-pay flow goes directly from
   vendor invoice to goods receipt without a purchase order. A PO approval workflow (requisition →
   PO → GR → invoice matching / 3-way match) is deferred to a future phase.

2. **Warehouse / bin location not modelled** — `inventory_movements` has no bin or warehouse
   dimension. Multi-location inventory tracking is deferred.

3. **FIFO method not supported** — only the perpetual weighted-average method (VAS 02,
   Thông tư 133) is implemented. FIFO costing would require tracking individual receipt lots;
   deferred to a future phase.

4. **Purchase invoice cancellation / inventory value-restoration caveat** — cancelling a posted
   purchase invoice is fully automated: `PurchaseInvoiceService.cancel()`
   (`apps/api/src/purchasing/purchase-invoice.service.ts`) posts a reversing journal entry
   (Dr 331 / Cr 152 or 156 / Cr 1331) AND reverses the inventory movement per line via
   `InventoryService.applyReversal()` (proven by `apps/api/test/purchase-invoice.int.test.ts`).
   The remaining limitation is value restoration, not automation: `applyReversal` is best-effort.
   If intervening goods issues drew the material's on-hand balance below the originally received
   quantity, removing the original receipt's quantity and value can over- or under-shoot the
   moving-average value (and the reversal is not guarded against driving the balance negative).
   Exact-value restatement requires a restitution/restatement engine that replays movements at
   their correct post-reversal moving averages; that is deferred to a future phase.
