# Open Questions

Unresolved regulatory and technical decisions that must be confirmed before the relevant modules are built.

1. **CIT rates & 2025 law** — Confirm current Corporate Income Tax rates and any structural changes introduced by the new 2025 CIT law (replacing Circular 78/2014 & 96/2015). Update `docs/regulations/README.md` and the CIT calculation module once verified.

2. **PIT exemption thresholds & family deductions (Dec-2025 amendment)** — The December 2025 amendment to PIT (Circular 111/2013) may revise personal exemption amounts and dependant deduction figures. Confirm exact values before implementing payroll/PIT features.

3. **2026 household declaration circular** — Resolution 68-NQ/TW and Law 198/2025/QH15 mandate a new simplified declaration regime for household businesses effective 2026, with implementation detail deferred to a forthcoming MoF/GDT circular (expected Q1–Q2 2026). Track and incorporate when published.

4. **E-invoice provider** — Select the first provider integration target: Viettel, VNPT, or MISA. Decision affects the e-invoice transmission API adapter implemented in Task 9 and the e-invoice provider plugin architecture.
