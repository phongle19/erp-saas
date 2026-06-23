import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';
import { eq, and, asc, sql } from 'drizzle-orm';
import { schema } from '@erp/db';
import {
  lineNet,
  vatFor,
  findEffectiveRule,
  type Rule,
  type VatRuleType,
} from '@erp/domain';
import { currentTx } from '../db/tx-context.js';
import { DocumentPostingService } from '../documents/document-posting.js';
import { InventoryService } from '../inventory/inventory.service.js';

/** Input VAT deductible (Thuế GTGT được khấu trừ) — Circular 133. */
const INPUT_VAT_ACCOUNT = '1331';
/** Accounts payable to suppliers (Phải trả người bán) — Circular 133. */
const AP_ACCOUNT = '331';

export interface PurchaseInvoiceLineInput {
  materialId: string;
  /** Whole-unit integer string. */
  quantity: string;
  /** Minor-unit integer string. */
  unitCostMinor: string;
  vatRuleType: VatRuleType;
}

export interface CreatePurchaseInvoiceInput {
  partnerId: string; // vendor
  invoiceDate: string; // ISO 'YYYY-MM-DD'
  periodId: string;
  vendorInvoiceNo?: string | undefined;
  nonCashPayment?: boolean | undefined;
  description?: string | undefined;
  lines: PurchaseInvoiceLineInput[];
}

type Invoice = typeof schema.purchaseInvoices.$inferSelect;
type InvoiceLine = typeof schema.purchaseInvoiceLines.$inferSelect;

export interface PurchaseInvoiceWithLines extends Invoice {
  lines: InvoiceLine[];
}

@Injectable()
export class PurchaseInvoiceService {
  constructor(
    private readonly posting: DocumentPostingService,
    private readonly inventory: InventoryService,
  ) {}

  /**
   * Create AND post a purchase invoice in one request transaction (Phase 2b).
   *
   * Mirrors the A5 sales-invoice flow: each line's input-VAT rate is resolved by
   * effective-dated lookup against tax_rules, so a `vat_rate_reduced` (8%) line
   * dated after the window closes (2026-12-31) is rejected (422).
   *
   * Goods receipt: each line calls InventoryService.applyReceipt INSIDE this same
   * tenant tx (weighted-average), so the inventory movement, the journal entry, and
   * the invoice rows all commit (or roll back) atomically.
   */
  async createAndPost(
    companyId: string,
    input: CreatePurchaseInvoiceInput,
  ): Promise<PurchaseInvoiceWithLines> {
    const tx = currentTx();
    const { db } = tx;

    // 1. App-layer access gate (mirrors RLS / the engine; fail fast with 403).
    if (!tx.isAdmin && !tx.accessibleCompanies.includes(companyId)) {
      throw new ForbiddenException('access to company denied');
    }

    // Period must be open AND belong to companyId; read fiscalYear.
    const periodRows = await db
      .select({
        companyId: schema.accountingPeriods.companyId,
        fiscalYear: schema.accountingPeriods.fiscalYear,
        status: schema.accountingPeriods.status,
      })
      .from(schema.accountingPeriods)
      .where(eq(schema.accountingPeriods.id, input.periodId))
      .limit(1);
    const period = periodRows[0];
    if (!period || period.companyId !== companyId) {
      throw new UnprocessableEntityException(
        'period does not belong to company',
      );
    }
    if (period.status !== 'open') {
      throw new UnprocessableEntityException(
        `period is not open (status: ${period.status})`,
      );
    }
    const fiscalYear = period.fiscalYear;

    // 2. Resolve the vendor: must be a business_partner of THIS company
    //    (RLS-scoped select — defense in depth so the AP partnerId is correct).
    const partnerRows = await db
      .select({ id: schema.businessPartners.id })
      .from(schema.businessPartners)
      .where(
        and(
          eq(schema.businessPartners.id, input.partnerId),
          eq(schema.businessPartners.companyId, companyId),
        ),
      )
      .limit(1);
    if (!partnerRows[0]) {
      throw new UnprocessableEntityException(
        'vendor not found for this company',
      );
    }

    if (input.lines.length === 0) {
      throw new UnprocessableEntityException(
        'invoice must have at least one line',
      );
    }

    // 3. Per-line: resolve material → inventory account; net + effective-dated input VAT.
    interface ComputedLine {
      lineNo: number;
      materialId: string;
      quantity: bigint;
      unitCostMinor: bigint;
      lineCost: bigint;
      vatRuleType: VatRuleType;
      ratePct: bigint;
      vat: bigint;
      inventoryAccountCode: string;
    }

    const computed: ComputedLine[] = [];
    let lineNo = 0;
    for (const line of input.lines) {
      lineNo += 1;

      // Resolve the material: must belong to THIS company (RLS-scoped); its
      // inventoryAccountCode drives the Dr side (156 goods / 152 raw materials).
      const matRows = await db
        .select({
          inventoryAccountCode: schema.materials.inventoryAccountCode,
        })
        .from(schema.materials)
        .where(
          and(
            eq(schema.materials.id, line.materialId),
            eq(schema.materials.companyId, companyId),
          ),
        )
        .limit(1);
      if (!matRows[0]) {
        throw new UnprocessableEntityException(
          'material not found for this company',
        );
      }
      const inventoryAccountCode = matRows[0].inventoryAccountCode;

      const lineCost = lineNet(
        BigInt(line.quantity),
        BigInt(line.unitCostMinor),
      );

      // Resolve the input-VAT rate effective on the invoice date.
      // Input VAT (deductible) is recorded to TK 1331 — Law on VAT 48/2024/QH15.
      // The Law's input-VAT credit conditions require a non-cash payment voucher
      // for any invoice ≥ VND 5,000,000 (recorded via `nonCashPayment`); a cash
      // settlement at/above that threshold forfeits the credit. We capture the
      // flag here for the audit trail; the deduction-eligibility check is a
      // downstream declaration concern. Effective dating is enforced: a line
      // whose rule type has no rule effective on invoiceDate is rejected (422),
      // so a 2027 invoice can't claim the 8% reduced rate.
      const ruleRows = await db
        .select({
          ruleType: schema.taxRules.ruleType,
          value: schema.taxRules.value,
          effectiveFrom: schema.taxRules.effectiveFrom,
          effectiveTo: schema.taxRules.effectiveTo,
          sourceRegulation: schema.taxRules.sourceRegulation,
        })
        .from(schema.taxRules)
        .where(eq(schema.taxRules.ruleType, line.vatRuleType))
        .orderBy(asc(schema.taxRules.effectiveFrom));
      const rules: Rule[] = ruleRows.map((r) => ({
        ruleType: r.ruleType,
        value: r.value,
        effectiveFrom: r.effectiveFrom,
        effectiveTo: r.effectiveTo,
        sourceRegulation: r.sourceRegulation,
      }));
      const rule = findEffectiveRule(rules, line.vatRuleType, input.invoiceDate);
      if (!rule) {
        throw new UnprocessableEntityException(
          `vat rule '${line.vatRuleType}' not effective on ${input.invoiceDate}`,
        );
      }
      const ratePct = BigInt(rule.value);
      const vat = vatFor(lineCost, ratePct);

      computed.push({
        lineNo,
        materialId: line.materialId,
        quantity: BigInt(line.quantity),
        unitCostMinor: BigInt(line.unitCostMinor),
        lineCost,
        vatRuleType: line.vatRuleType,
        ratePct,
        vat,
        inventoryAccountCode,
      });
    }

    // 4. Totals.
    const subtotal = computed.reduce((s, l) => s + l.lineCost, 0n);
    const vatTotal = computed.reduce((s, l) => s + l.vat, 0n);
    const total = subtotal + vatTotal;

    // 5. Build the journal lines: Dr inventory (grouped by inventoryAccountCode);
    //    Dr 1331 (omit if vatTotal === 0); Cr 331 (total, with vendor partnerId).
    const inventoryByAccount = new Map<string, bigint>();
    for (const l of computed) {
      inventoryByAccount.set(
        l.inventoryAccountCode,
        (inventoryByAccount.get(l.inventoryAccountCode) ?? 0n) + l.lineCost,
      );
    }

    const journalLines: {
      accountCode: string;
      debitMinor: string;
      creditMinor: string;
      partnerId?: string;
      memo?: string;
    }[] = [];
    for (const [code, cost] of inventoryByAccount) {
      journalLines.push({
        accountCode: code,
        debitMinor: cost.toString(),
        creditMinor: '0',
      });
    }
    if (vatTotal !== 0n) {
      journalLines.push({
        accountCode: INPUT_VAT_ACCOUNT,
        debitMinor: vatTotal.toString(),
        creditMinor: '0',
      });
    }
    journalLines.push({
      accountCode: AP_ACCOUNT,
      debitMinor: '0',
      creditMinor: total.toString(),
      partnerId: input.partnerId,
    });

    const description =
      input.description ?? `Hóa đơn mua hàng ${input.invoiceDate}`;

    const { journalEntryId } = await this.posting.postDocument({
      companyId,
      periodId: input.periodId,
      entryDate: input.invoiceDate,
      description,
      lines: journalLines,
    });

    // 6. Persist: invoiceNo = MAX+1 per (companyId, fiscalYear).
    const maxRows = await db
      .select({
        maxNo: sql<number>`COALESCE(MAX(${schema.purchaseInvoices.invoiceNo}), 0)`,
      })
      .from(schema.purchaseInvoices)
      .where(
        and(
          eq(schema.purchaseInvoices.companyId, companyId),
          eq(schema.purchaseInvoices.fiscalYear, fiscalYear),
        ),
      );
    const invoiceNo = Number(maxRows[0]?.maxNo ?? 0) + 1;

    const [invoice] = await db
      .insert(schema.purchaseInvoices)
      .values({
        companyId,
        partnerId: input.partnerId,
        invoiceNo,
        vendorInvoiceNo: input.vendorInvoiceNo ?? null,
        invoiceDate: input.invoiceDate,
        periodId: input.periodId,
        fiscalYear,
        description: input.description ?? null,
        nonCashPayment: input.nonCashPayment ?? false,
        status: 'posted',
        journalEntryId,
        subtotalMinor: subtotal,
        vatMinor: vatTotal,
        totalMinor: total,
        createdBy: tx.userId,
        postedAt: new Date(),
      })
      .returning();

    const lineValues = computed.map((l) => ({
      invoiceId: invoice!.id,
      companyId,
      lineNo: l.lineNo,
      materialId: l.materialId,
      quantity: l.quantity,
      unitCostMinor: l.unitCostMinor,
      lineCostMinor: l.lineCost,
      vatRuleType: l.vatRuleType,
      vatRatePct: Number(l.ratePct),
      vatMinor: l.vat,
      inventoryAccountCode: l.inventoryAccountCode,
    }));
    const lines = await db
      .insert(schema.purchaseInvoiceLines)
      .values(lineValues)
      .returning();

    // 7. Goods receipt: per line, apply the weighted-average receipt INSIDE this
    //    same tx (movement + journal + invoice commit atomically). sourceDocId is
    //    the just-inserted invoice id.
    for (const l of computed) {
      await this.inventory.applyReceipt({
        materialId: l.materialId,
        quantity: l.quantity,
        cost: l.lineCost,
        sourceDocType: 'purchase_invoice',
        sourceDocId: invoice!.id,
        journalEntryId,
        periodId: input.periodId,
        movementDate: input.invoiceDate,
        companyId,
      });
    }

    return { ...invoice!, lines };
  }

  /** RLS-scoped invoice + lines, or 404 if not found / hidden. */
  async get(invoiceId: string): Promise<PurchaseInvoiceWithLines> {
    const { db } = currentTx();
    const rows = await db
      .select()
      .from(schema.purchaseInvoices)
      .where(eq(schema.purchaseInvoices.id, invoiceId))
      .limit(1);
    const invoice = rows[0];
    if (!invoice) throw new NotFoundException('purchase invoice not found');

    const lines = await db
      .select()
      .from(schema.purchaseInvoiceLines)
      .where(eq(schema.purchaseInvoiceLines.invoiceId, invoiceId))
      .orderBy(asc(schema.purchaseInvoiceLines.lineNo));

    return { ...invoice, lines };
  }

  /**
   * Cancel a posted purchase invoice:
   *   - reverse its journal entry (the reversal carries the vendor partnerId, so
   *     AP nets back to zero; Cr 156/152, Cr 1331, Dr 331),
   *   - reverse the inventory: per line, remove the originally-received quantity at
   *     the ORIGINAL line cost via InventoryService.applyReversal (exact restoration;
   *     see the caveat in applyReversal),
   *   - mark the invoice cancelled.
   *
   * All in the one request tx (atomic with the reversal post).
   */
  async cancel(invoiceId: string): Promise<PurchaseInvoiceWithLines> {
    const { db } = currentTx();
    const current = await this.get(invoiceId);

    if (current.status !== 'posted') {
      throw new UnprocessableEntityException(
        `only posted invoices can be cancelled (status: ${current.status})`,
      );
    }
    if (!current.journalEntryId) {
      throw new UnprocessableEntityException(
        'invoice has no journal entry to reverse',
      );
    }

    const { reversalEntryId } = await this.posting.reverseDocument(
      current.journalEntryId,
    );

    // Reverse each line's goods receipt (remove qty at the original line cost).
    for (const l of current.lines) {
      await this.inventory.applyReversal({
        materialId: l.materialId,
        quantity: l.quantity,
        cost: l.lineCostMinor,
        sourceDocType: 'purchase_invoice_cancel',
        sourceDocId: current.id,
        journalEntryId: reversalEntryId,
        periodId: current.periodId,
        movementDate: current.invoiceDate,
        companyId: current.companyId,
      });
    }

    await db
      .update(schema.purchaseInvoices)
      .set({ status: 'cancelled' })
      .where(eq(schema.purchaseInvoices.id, invoiceId));

    return this.get(invoiceId);
  }
}
