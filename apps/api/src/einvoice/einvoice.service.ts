/**
 * E-invoice issuance service.
 *
 * Statutory basis:
 *   - Decree 123/2020/ND-CP: e-invoice framework, issuance obligations
 *   - Decree 70/2025/ND-CP: amendments (effective 2025) — updated issuance timelines
 *   - Circular 78/2021/TT-BTC: technical implementation guidance
 *
 * The e-invoice is NOT a GL event. The GL effect was already recorded when the
 * sales invoice was posted (Dr 131 / Cr 511 / Cr 3331). This module only handles
 * the statutory e-invoice issuance formality.
 */
import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { schema } from '@erp/db';
import { currentTx } from '../db/tx-context.js';
import { EInvoiceProviderRegistry } from './provider.registry.js';
import type { EInvoiceIssueDoc } from './einvoice.types.js';

type EInvoiceRow = typeof schema.einvoices.$inferSelect;

/**
 * Circular 78/2021/TT-BTC Annex I: mẫu số '1' is the standard VAT invoice form.
 * Ký hiệu placeholder — real values come from provider registration with GDT
 * (Decree 123/2020/ND-CP Art. 10). Typically of the form 'C26TAA' where C=e-invoice,
 * 26=year, T=tax type code, AA=series letters assigned by the provider.
 */
const DEFAULT_MAU_SO = '1';
const DEFAULT_KY_HIEU = 'C26TAA'; // placeholder; real value from GDT registration

@Injectable()
export class EInvoiceService {
  constructor(private readonly registry: EInvoiceProviderRegistry) {}

  /**
   * Issue an e-invoice for a posted sales invoice.
   *
   * Idempotency: if an 'issued' e-invoice already exists for this sales invoice,
   * returns 409. A 'cancelled' prior record allows re-issue.
   *
   * Decree 123/2020/ND-CP Art. 9: e-invoices must be issued at the time of sale;
   * Decree 70/2025/ND-CP Art. 1 §7: updated timeline for certain goods.
   */
  async issueForInvoice(salesInvoiceId: string): Promise<EInvoiceRow> {
    const tx = currentTx();
    const { db } = tx;

    // 1. Load the sales invoice (RLS-scoped).
    const invRows = await db
      .select()
      .from(schema.salesInvoices)
      .where(eq(schema.salesInvoices.id, salesInvoiceId))
      .limit(1);
    const invoice = invRows[0];
    if (!invoice) throw new NotFoundException('sales invoice not found');

    // 2. App-layer access gate.
    if (!tx.isAdmin && !tx.accessibleCompanies.includes(invoice.companyId)) {
      throw new ForbiddenException('access to company denied');
    }

    // 3. Only posted invoices can be e-invoiced.
    // Decree 123/2020/ND-CP Art. 9: the e-invoice is issued at the point of sale;
    // the underlying sales invoice must be in 'posted' (settled in the GL) status.
    if (invoice.status !== 'posted') {
      throw new UnprocessableEntityException(
        'only posted invoices can be e-invoiced',
      );
    }

    // 4. Idempotency: reject if an 'issued' e-invoice already exists.
    const existing = await db
      .select({ id: schema.einvoices.id, status: schema.einvoices.status })
      .from(schema.einvoices)
      .where(
        and(
          eq(schema.einvoices.salesInvoiceId, salesInvoiceId),
          eq(schema.einvoices.status, 'issued'),
        ),
      )
      .limit(1);
    if (existing[0]) {
      throw new ConflictException(
        'an issued e-invoice already exists for this sales invoice',
      );
    }

    // 5. Load company (for seller MST + einvoiceProvider selection).
    const companyRows = await db
      .select({
        id: schema.companies.id,
        name: schema.companies.name,
        mst: schema.companies.mst,
        einvoiceProvider: schema.companies.einvoiceProvider,
      })
      .from(schema.companies)
      .where(eq(schema.companies.id, invoice.companyId))
      .limit(1);
    const company = companyRows[0];
    if (!company) throw new NotFoundException('company not found');

    // 6. Load partner (buyer MST / name / address).
    const partnerRows = await db
      .select({
        id: schema.businessPartners.id,
        name: schema.businessPartners.name,
        taxCode: schema.businessPartners.taxCode,
        address: schema.businessPartners.address,
      })
      .from(schema.businessPartners)
      .where(eq(schema.businessPartners.id, invoice.partnerId))
      .limit(1);
    const partner = partnerRows[0];
    if (!partner) throw new NotFoundException('business partner not found');

    // 7. Load invoice lines (for GDT item breakdown).
    const lines = await db
      .select()
      .from(schema.salesInvoiceLines)
      .where(eq(schema.salesInvoiceLines.invoiceId, salesInvoiceId));

    // 8. Build the GDT-shaped payload.
    // Circular 78/2021/TT-BTC Annex II: required fields for e-invoice content.
    const payload: EInvoiceIssueDoc = {
      seller: {
        mst: company.mst ?? '',
        name: company.name,
        address: '', // address not on companies table in Phase 1; extend in Phase 3
      },
      buyer: {
        mst: partner.taxCode ?? '',
        name: partner.name,
        address: partner.address ?? '',
      },
      mauSo: DEFAULT_MAU_SO,
      kyHieu: DEFAULT_KY_HIEU,
      currency: invoice.companyId ? 'VND' : 'VND', // functional currency; Phase 2a is VND-only
      items: lines.map((l) => ({
        description: l.description,
        quantity: l.quantity.toString(),
        unitPrice: l.unitPriceMinor.toString(),
        lineNet: l.lineNetMinor.toString(),
        vatRatePct: l.vatRatePct,
        vatAmount: l.vatMinor.toString(),
      })),
      subtotal: invoice.subtotalMinor.toString(),
      vat: invoice.vatMinor.toString(),
      total: invoice.totalMinor.toString(),
    };

    // 9. Insert a 'pending' row first (idempotency marker before provider call).
    const [pending] = await db
      .insert(schema.einvoices)
      .values({
        companyId: invoice.companyId,
        salesInvoiceId,
        provider: company.einvoiceProvider,
        mauSo: DEFAULT_MAU_SO,
        kyHieu: DEFAULT_KY_HIEU,
        sellerMst: company.mst ?? null,
        buyerMst: partner.taxCode ?? null,
        buyerName: partner.name,
        buyerAddress: partner.address ?? null,
        currency: 'VND',
        subtotalMinor: invoice.subtotalMinor,
        vatMinor: invoice.vatMinor,
        totalMinor: invoice.totalMinor,
        status: 'pending',
        payload,
      })
      .returning();

    // 10. Call the provider stub.
    // Decree 123/2020/ND-CP Art. 14: the provider signs and submits to GDT.
    const result = await this.registry
      .getProvider(company.einvoiceProvider)
      .issue(payload);

    // 11. Update the row with provider result.
    const [issued] = await db
      .update(schema.einvoices)
      .set({
        status: result.status,
        providerCode: result.providerCode,
        soHoaDon: result.soHoaDon,
        gdtMessageId: result.gdtMessageId ?? null,
        issuedAt: result.status === 'issued' ? new Date() : null,
      })
      .where(eq(schema.einvoices.id, pending!.id))
      .returning();

    return issued!;
  }

  /**
   * Cancel an issued e-invoice.
   *
   * Decree 123/2020/ND-CP Art. 19: cancellation requires notifying GDT within
   * the prescribed period. The stub acknowledges immediately.
   */
  async cancel(einvoiceId: string): Promise<EInvoiceRow> {
    const tx = currentTx();
    const { db } = tx;

    const rows = await db
      .select()
      .from(schema.einvoices)
      .where(eq(schema.einvoices.id, einvoiceId))
      .limit(1);
    const einvoice = rows[0];
    if (!einvoice) throw new NotFoundException('e-invoice not found');

    // App-layer access gate.
    if (!tx.isAdmin && !tx.accessibleCompanies.includes(einvoice.companyId)) {
      throw new ForbiddenException('access to company denied');
    }

    if (einvoice.status !== 'issued') {
      throw new UnprocessableEntityException(
        `only issued e-invoices can be cancelled (status: ${einvoice.status})`,
      );
    }

    // Call provider cancellation (stub acknowledges immediately).
    await this.registry
      .getProvider(einvoice.provider)
      .cancel(einvoice.providerCode ?? '');

    const [cancelled] = await db
      .update(schema.einvoices)
      .set({ status: 'cancelled' })
      .where(eq(schema.einvoices.id, einvoiceId))
      .returning();

    return cancelled!;
  }

  /** Retrieve an e-invoice by id (RLS-scoped); 404 if not found / hidden. */
  async get(einvoiceId: string): Promise<EInvoiceRow> {
    const tx = currentTx();
    const { db } = tx;

    const rows = await db
      .select()
      .from(schema.einvoices)
      .where(eq(schema.einvoices.id, einvoiceId))
      .limit(1);
    const einvoice = rows[0];
    if (!einvoice) throw new NotFoundException('e-invoice not found');

    // App-layer access gate.
    if (!tx.isAdmin && !tx.accessibleCompanies.includes(einvoice.companyId)) {
      throw new ForbiddenException('access to company denied');
    }

    return einvoice;
  }
}
