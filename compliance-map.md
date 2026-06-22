# Compliance Map

Maps each rule or compliance feature to its source regulation and implementation location.

- **Status: DONE** — implemented and tested in Phase 0.
- **Status: PLANNED** — schema/data model exists; engine/logic is Phase 1+.
- **Status: STUB** — registry entry created; content deferred to Phase 1.

Add a row here whenever you implement a rule. Every rule must also have a code comment
citing the source regulation at its call site. Ambiguities go to `docs/open-questions.md`.

---

| Rule / Feature | Source Regulation | Where Implemented | Status |
|---|---|---|---|
| VAT standard rate 10% | Luật Thuế GTGT (Law on VAT), consolidated | `packages/db/src/seed.ts` (`tax_rules` row `vat_rate`), `packages/domain/src/rules.ts` (`findEffectiveRule`) | DONE |
| VAT reduced rate 8% through 2026-12-31 | Nghị quyết 204/2025/QH15 (Resolution 204/2025/QH15) | `packages/db/src/seed.ts` (`tax_rules` row `vat_rate_reduced`, `effective_from='2025-01-01'`, `effective_to='2027-01-01'` [exclusive]) | DONE |
| Input-VAT non-cash deductibility threshold ≥ VND 5,000,000 (from 2025-07-01) | Luật Thuế GTGT số 48/2024/QH15 (Law on VAT 48/2024/QH15) | `packages/db/src/seed.ts` (`tax_rules` row `input_vat_noncash_threshold`, `effective_from='2025-07-01'`) | DONE |
| Household business revenue tier exempt threshold VND 200,000,000 | Nghị quyết 198/2025/QH15 (Resolution 198/2025/QH15) | `packages/db/src/seed.ts` (`tax_rules` row `household_tier_threshold_exempt`) | DONE |
| Household tier enum (lt_200m / 200m_1b / gt_1b / gt_3b) | Nghị quyết 198/2025/QH15 | `packages/db/src/schema/enums.ts` (`householdTier` pgEnum) | DONE |
| Accounting regime — SME (DNNVV) | Thông tư 133/2016/TT-BTC | `packages/db/src/schema/enums.ts` (`circular_133`), `packages/config-regimes/src/registry.ts` | STUB (content Phase 1) |
| Accounting regime — Household / individual business (Hộ KD) | Thông tư 88/2021/TT-BTC | `packages/db/src/schema/enums.ts` (`circular_88`), `packages/config-regimes/src/registry.ts` | STUB (content Phase 1) |
| Accounting regime — Micro-enterprise (Doanh nghiệp siêu nhỏ) | Thông tư 132/2018/TT-BTC | `packages/db/src/schema/enums.ts` (`circular_132`), `packages/config-regimes/src/registry.ts` | STUB (content Phase 1) |
| Accounting regime — Standard enterprise | Thông tư 200/2014/TT-BTC | `packages/db/src/schema/enums.ts` (`circular_200`), `packages/config-regimes/src/registry.ts` | STUB (content Phase 1) |
| Statutory consolidation data model (VAS 25 / Circular 202) | VAS 25; Thông tư 202/2014/TT-BTC | `packages/db/src/schema/groups.ts` (STATUTORY group type), `packages/db/src/schema/companies.ts` (`ownership_links`), `packages/db/src/schema/coa.ts` (`group_chart_of_accounts`, `coa_mappings`) | PLANNED (engine Phase 1+) |
| Management / portfolio consolidation | Business requirement (no single regulation) | `packages/db/src/schema/groups.ts` (MANAGEMENT group type), group membership + CoA mapping | PLANNED (engine Phase 1+) |
| `ownership_pct` stored as basis points (0–10000 = 0.00%–100.00%) | Engineering convention — integer precision without floats | `packages/db/src/schema/companies.ts` (`ownership_links.ownership_pct`, CHECK constraint) | DONE |
| Append-only audit log / financial record immutability | Luật Kế toán số 88/2015/QH13 (Law on Accounting 88/2015), Art. 19 | `packages/db/src/schema/audit.ts` (`audit_log` table, no UPDATE/DELETE allowed), `apps/api/src/audit/audit.interceptor.ts` | DONE |
| Audit log commits atomically with request (no silent loss) | Audit integrity principle | `apps/api/src/audit/audit.interceptor.ts` (awaits INSERT via `mergeMap` inside request tx) | DONE |
| RLS fail-closed: empty/unset `app.accessible_companies` yields no rows | Security design | `packages/db/src/rls.sql` (`app_accessible_companies()` returns `ARRAY[]::uuid[]` when unset) | DONE |
| Data residency is deployer's responsibility | Nghị định 53/2022/ND-CP (Decree 53/2022 on data localisation) | Documented in `README.md`, `ARCHITECTURE.md`; self-hosted Docker, no telemetry | DONE (deployer obligation) |
| CoA seeded per regime (account codes, names, types) | Thông tư 133, 88, 132, 200 appendices | `packages/config-regimes/src/registry.ts` (`chartOfAccounts` arrays, currently empty) | PLANNED (Phase 1) |
| Balance Sheet + Income Statement templates | Thông tư 133/2016 (Mẫu B01, B02-DNN) | `packages/config-regimes/src/registry.ts` (`statementTemplates`, currently empty) | PLANNED (Phase 1) |
| VAT declaration form 01/GTGT | Thông tư 80/2021/TT-BTC; Nghị định 126/2020/ND-CP | `packages/config-regimes/src/registry.ts` (`declarationForms`, currently empty) | PLANNED (Phase 2) |
| Double-entry enforcement (Σdebits = Σcredits) | Luật Kế toán số 88/2015/QH13, Art. 17 (bút toán kép) | PostingEngine (Phase 1) | PLANNED (Phase 1) |
| E-invoice issuance | Nghị định 123/2020/ND-CP; Thông tư 78/2021/TT-BTC | Provider abstraction layer (Phase 2) | PLANNED (Phase 2) |
| Fixed asset depreciation | Thông tư 45/2013/TT-BTC | Fixed Assets module (Phase 2) | PLANNED (Phase 2) |
| Payroll / PIT withholding | Luật Thuế TNCN; Thông tư 111/2013/TT-BTC (+ Dec-2025 amendment) | Payroll module (Phase 2) | PLANNED (Phase 2) |
| BHXH/BHYT/BHTN rates | Luật BHXH; các nghị định hướng dẫn | Payroll module (Phase 2) | PLANNED (Phase 2) |
| CIT rates and calculation | Luật Thuế TNDN; 2025 CIT law (confirm — see open-questions.md #1) | Tax Engine (Phase 2) | PLANNED (Phase 2) |
