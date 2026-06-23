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

/** AR control account (Phải thu khách hàng) — Circular 133. */
const AR_ACCOUNT = '131';
/** Output VAT payable (Thuế GTGT đầu ra phải nộp) — Circular 133. */
const OUTPUT_VAT_ACCOUNT = '3331';

export interface SalesInvoiceLineInput {
  description: string;
  /** Whole-unit integer string. */
  quantity: string;
  /** Minor-unit integer string. */
  unitPriceMinor: string;
  vatRuleType: VatRuleType;
  revenueAccountCode?: string | undefined;
}

export interface CreateSalesInvoiceInput {
  partnerId: string;
  invoiceDate: string; // ISO 'YYYY-MM-DD'
  periodId: string;
  description?: string | undefined;
  lines: SalesInvoiceLineInput[];
}

type Invoice = typeof schema.salesInvoices.$inferSelect;
type InvoiceLine = typeof schema.salesInvoiceLines.$inferSelect;

export interface InvoiceWithLines extends Invoice {
  lines: InvoiceLine[];
}

@Injectable()
export class SalesInvoiceService {
  constructor(private readonly posting: DocumentPostingService) {}

  /**
   * Create AND post a sales invoice in one request transaction (Phase 2a).
   *
   * VAT is resolved per line by effective-dated rule lookup against tax_rules,
   * so a `vat_rate_reduced` (8%) line dated after the 8% window closes
   * (2026-12-31) is correctly rejected — there is no rule effective on that date.
   *
   * The whole operation runs in the request tenant tx: if posting fails the
   * invoice + line rows roll back too.
   */
  async createAndPost(
    companyId: string,
    input: CreateSalesInvoiceInput,
  ): Promise<InvoiceWithLines> {
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

    // 2. Resolve the customer: must be a business_partner of THIS company
    //    (RLS-scoped select — defense in depth so the AR partnerId is correct).
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
        'customer not found for this company',
      );
    }

    if (input.lines.length === 0) {
      throw new UnprocessableEntityException('invoice must have at least one line');
    }

    // 3. Per-line: net + effective-dated VAT.
    interface ComputedLine {
      lineNo: number;
      description: string;
      quantity: bigint;
      unitPriceMinor: bigint;
      net: bigint;
      vatRuleType: VatRuleType;
      ratePct: bigint;
      vat: bigint;
      revenueAccountCode: string;
    }

    const computed: ComputedLine[] = [];
    let lineNo = 0;
    for (const line of input.lines) {
      lineNo += 1;
      const net = lineNet(BigInt(line.quantity), BigInt(line.unitPriceMinor));

      // Resolve the VAT rate effective on the invoice date.
      // Output VAT rate — Law on VAT 48/2024/QH15; the 8% `vat_rate_reduced`
      // window runs through 2026-12-31 per Resolution 204/2025/QH15. Effective
      // dating is enforced here: a line whose rule type has no rule effective
      // on invoiceDate is rejected (422), so a 2027 invoice can't claim 8%.
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
      const vat = vatFor(net, ratePct);

      computed.push({
        lineNo,
        description: line.description,
        quantity: BigInt(line.quantity),
        unitPriceMinor: BigInt(line.unitPriceMinor),
        net,
        vatRuleType: line.vatRuleType,
        ratePct,
        vat,
        revenueAccountCode: line.revenueAccountCode ?? '511',
      });
    }

    // 4. Totals.
    const subtotal = computed.reduce((s, l) => s + l.net, 0n);
    const vatTotal = computed.reduce((s, l) => s + l.vat, 0n);
    const total = subtotal + vatTotal;

    // 5. Build the journal lines: Dr 131 (total, with partnerId); Cr revenue
    //    (grouped by revenueAccountCode); Cr 3331 (omit if vatTotal === 0).
    const revenueByAccount = new Map<string, bigint>();
    for (const l of computed) {
      revenueByAccount.set(
        l.revenueAccountCode,
        (revenueByAccount.get(l.revenueAccountCode) ?? 0n) + l.net,
      );
    }

    const journalLines: {
      accountCode: string;
      debitMinor: string;
      creditMinor: string;
      partnerId?: string;
      memo?: string;
    }[] = [
      {
        accountCode: AR_ACCOUNT,
        debitMinor: total.toString(),
        creditMinor: '0',
        partnerId: input.partnerId,
      },
    ];
    for (const [code, net] of revenueByAccount) {
      journalLines.push({
        accountCode: code,
        debitMinor: '0',
        creditMinor: net.toString(),
      });
    }
    if (vatTotal !== 0n) {
      journalLines.push({
        accountCode: OUTPUT_VAT_ACCOUNT,
        debitMinor: '0',
        creditMinor: vatTotal.toString(),
      });
    }

    const description =
      input.description ?? `Hóa đơn bán hàng ${input.invoiceDate}`;

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
        maxNo: sql<number>`COALESCE(MAX(${schema.salesInvoices.invoiceNo}), 0)`,
      })
      .from(schema.salesInvoices)
      .where(
        and(
          eq(schema.salesInvoices.companyId, companyId),
          eq(schema.salesInvoices.fiscalYear, fiscalYear),
        ),
      );
    const invoiceNo = Number(maxRows[0]?.maxNo ?? 0) + 1;

    const [invoice] = await db
      .insert(schema.salesInvoices)
      .values({
        companyId,
        partnerId: input.partnerId,
        invoiceNo,
        invoiceDate: input.invoiceDate,
        periodId: input.periodId,
        fiscalYear,
        description: input.description ?? null,
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
      description: l.description,
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      lineNetMinor: l.net,
      vatRuleType: l.vatRuleType,
      vatRatePct: Number(l.ratePct),
      vatMinor: l.vat,
      revenueAccountCode: l.revenueAccountCode,
    }));
    const lines = await db
      .insert(schema.salesInvoiceLines)
      .values(lineValues)
      .returning();

    return { ...invoice!, lines };
  }

  /** RLS-scoped invoice + lines, or 404 if not found / hidden. */
  async get(invoiceId: string): Promise<InvoiceWithLines> {
    const { db } = currentTx();
    const rows = await db
      .select()
      .from(schema.salesInvoices)
      .where(eq(schema.salesInvoices.id, invoiceId))
      .limit(1);
    const invoice = rows[0];
    if (!invoice) throw new NotFoundException('sales invoice not found');

    const lines = await db
      .select()
      .from(schema.salesInvoiceLines)
      .where(eq(schema.salesInvoiceLines.invoiceId, invoiceId))
      .orderBy(asc(schema.salesInvoiceLines.lineNo));

    return { ...invoice, lines };
  }

  /**
   * Cancel a posted invoice: reverse its journal entry (the reversal carries
   * partnerId, so the customer's AR nets back to zero) and mark it cancelled.
   */
  async cancel(invoiceId: string): Promise<InvoiceWithLines> {
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

    await this.posting.reverseDocument(current.journalEntryId);

    await db
      .update(schema.salesInvoices)
      .set({ status: 'cancelled' })
      .where(eq(schema.salesInvoices.id, invoiceId));

    return this.get(invoiceId);
  }
}
